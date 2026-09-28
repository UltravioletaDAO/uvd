import { annotationObjection, FREE_CLASS, fromAnnotations, fromCatalog, refused, type Verdict } from '../classify.ts';
import { META_DIRECT_URL, META_SURFACE, META_TOOL } from '../emporium.ts';
import { type CatalogTool, type Emporium, type Surface, textOf } from '../emporium-client.ts';
import { EXIT, UvdError } from '../errors.ts';
import type { CallToolResult, Tool } from '../mcp.ts';
import { stripControl } from '../output.ts';

/**
 * `uvd call <tool> --input '{…}'`: calls a tool through Emporium's counter (`/mostrador/mcp`), and
 * only if it is free and read-only. uvd 0.1 has no wallet and no credentials: anything that moves
 * money, writes, charges or needs a credential is refused BEFORE any call is made. The decision is
 * always taken on a fresh tools/list of the counter, never on the cache.
 */
export async function call(emporium: Emporium, name: string, input: Record<string, unknown>): Promise<CallToolResult> {
  const counterTools = await emporium.connections.listTools(emporium.counterUrl);
  const matches = counterTools.filter((t) => t.name === name);
  if (matches.length === 0) throw await whyNotOnCounter(emporium, name);
  if (matches.length > 1) {
    throw refusal(
      name,
      refused('counter', 'sin_clasificar', `Emporium's counter lists ${matches.length} tools with that name`),
    );
  }
  const tool = matches[0] as Tool;

  const verdict = await classify(emporium, tool);
  if (!verdict.allowed) throw refusal(name, verdict, directUrl(tool));

  const result = await emporium.callCounter(name, input);
  if (result.isError) {
    throw new UvdError('tool_error', `${name} returned an error: ${textOf(result) || 'no details'}`, EXIT.toolError, {
      tool: name,
      result,
    });
  }
  return result;
}

/**
 * A forwarded tool: its surface must be in `emporium_superficies` and open (`auth.tipo` "none"),
 * then the catalog class decides, and annotations that object still win. A tool the catalog does
 * not classify (Emporium's own tools and combos) is judged by its annotations alone.
 */
async function classify(emporium: Emporium, tool: Tool): Promise<Verdict> {
  const surfaceId = tool._meta?.[META_SURFACE];
  const original = tool._meta?.[META_TOOL];
  if (surfaceId !== undefined) {
    const closed = surfaceObjection(await emporium.surfaces(), surfaceId);
    if (closed) return closed;
  }
  if (typeof surfaceId === 'string' && typeof original === 'string') {
    const entry = findEntry(await emporium.searchTool(original), surfaceId, original);
    if (entry) {
      const verdict = fromCatalog(entry, tool.name);
      return verdict.allowed ? (annotationObjection(tool) ?? verdict) : verdict;
    }
  }
  return fromAnnotations(tool);
}

/** Why a tool of `surfaceId` cannot be called without a credential, or `undefined` if it can. */
export function surfaceObjection(surfaces: Surface[], surfaceId: unknown): Verdict | undefined {
  const surface = surfaces.find((s) => s.id === surfaceId);
  const described = typeof surfaceId === 'string' ? `its surface "${surfaceId}"` : 'its surface';
  if (!surface) return refused('surface', 'pide_credencial', `${described} is not in Emporium's catalog`);
  const auth = surface.auth?.tipo;
  if (auth !== 'none') {
    return refused('surface', 'pide_credencial', `${described} needs a credential (auth: ${auth ?? 'not declared'})`);
  }
  return undefined;
}

/**
 * A name the counter does not publish. If it is `<surface>_<tool>` for a surface of the catalog
 * and the catalog gives that tool a class other than free, say so; otherwise, not found.
 */
async function whyNotOnCounter(emporium: Emporium, name: string): Promise<UvdError> {
  const surfaces = (await emporium.surfaces()).filter((s) => name.startsWith(`${s.id}_`));
  for (const surface of surfaces) {
    const original = name.slice(surface.id.length + 1);
    const entry = findEntry(await emporium.searchTool(original), surface.id, original);
    if (typeof entry?.por_que_no !== 'string' || entry.por_que_no === FREE_CLASS) continue;
    const verdict = fromCatalog(entry, null);
    if (!verdict.allowed) return refusal(name, verdict, entry.url_mcp ?? surface.url_mcp);
  }
  return new UvdError(
    'unknown_tool',
    `Emporium's counter has no tool "${name}". \`uvd tools\` and \`uvd search <text>\` list what can be called.`,
    EXIT.notFound,
    { tool: name },
  );
}

/** The catalog entry of `tool` on `surfaceId`: both must match, a namesake elsewhere does not count. */
export function findEntry(entries: CatalogTool[], surfaceId: string, tool: string): CatalogTool | undefined {
  return entries.find((e) => e.superficie_id === surfaceId && e.tool === tool);
}

function directUrl(tool: Tool): string | undefined {
  const url = tool._meta?.[META_DIRECT_URL];
  return typeof url === 'string' ? url : undefined;
}

function refusal(name: string, verdict: Verdict, url?: string): UvdError {
  const reason = verdict.allowed ? 'it is not a free read-only tool' : verdict.reason;
  return new UvdError(
    'refused',
    `uvd will not call ${name}: ${reason}. uvd 0.1 has no wallet and no credentials, so it only calls free read-only tools; paid, writing and authenticated calls arrive in a later version.${url ? ` Its direct endpoint is ${url}` : ''}`,
    EXIT.refused,
    { tool: name, class: verdict.toolClass, source: verdict.source, ...(url ? { url_mcp: url } : {}) },
  );
}

/** What `call` prints: the structured output if the tool gave one, otherwise its content blocks. */
export function callPayload(result: CallToolResult): unknown {
  return result.structuredContent ?? result.content;
}

/** The human rendering: the tool's text without terminal control characters, or pretty JSON. */
export function callText(result: CallToolResult): string {
  const text = stripControl(textOf(result));
  if (text) return text.endsWith('\n') ? text : `${text}\n`;
  return `${JSON.stringify(callPayload(result), null, 2)}\n`;
}
