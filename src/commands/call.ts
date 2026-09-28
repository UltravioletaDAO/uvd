import { fromAnnotations, fromCatalog, type Verdict } from '../classify.ts';
import { META_DIRECT_URL, META_SURFACE, META_TOOL } from '../emporium.ts';
import { type CatalogTool, type Emporium, textOf } from '../emporium-client.ts';
import { EXIT, UvdError } from '../errors.ts';
import type { CallToolResult, Tool } from '../mcp.ts';

/**
 * `uvd call <tool> --input '{…}'`: calls a tool through Emporium's counter (`/mostrador/mcp`), and
 * only if it is free and read-only. uvd 0.1 has no wallet and no credentials: anything that moves
 * money, writes, charges or needs a credential is refused BEFORE any call is made.
 */
export async function call(emporium: Emporium, name: string, input: Record<string, unknown>): Promise<CallToolResult> {
  const counterTools = await emporium.listTools(emporium.counterUrl);
  const tool = counterTools.find((t) => t.name === name);
  if (!tool) throw await whyNotOnCounter(emporium, name);

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

/** The catalog class first; the MCP annotations only when the catalog does not know the tool. */
async function classify(emporium: Emporium, tool: Tool): Promise<Verdict> {
  const surfaceId = tool._meta?.[META_SURFACE];
  const original = tool._meta?.[META_TOOL];
  if (typeof surfaceId === 'string' && typeof original === 'string') {
    const entry = findEntry(await emporium.searchTool(original), surfaceId, original);
    if (entry) return fromCatalog(entry);
  }
  return fromAnnotations(tool);
}

/**
 * A name the counter does not publish. If it is `<surface>_<tool>` for a surface of the catalog
 * and the catalog knows that tool, say why it is not callable (its class); otherwise, not found.
 */
async function whyNotOnCounter(emporium: Emporium, name: string): Promise<UvdError> {
  const surfaces = (await emporium.surfaces()).filter((s) => name.startsWith(`${s.id}_`));
  for (const surface of surfaces) {
    const original = name.slice(surface.id.length + 1);
    const entry = findEntry(await emporium.searchTool(original), surface.id, original);
    if (!entry) continue;
    const verdict = fromCatalog(entry);
    if (!verdict.allowed) return refusal(name, verdict, entry.url_mcp ?? surface.url_mcp);
  }
  return new UvdError(
    'unknown_tool',
    `Emporium's counter has no tool "${name}". \`uvd tools\` and \`uvd search <text>\` list what can be called.`,
    EXIT.notFound,
    { tool: name },
  );
}

function findEntry(entries: CatalogTool[], surfaceId: string, tool: string): CatalogTool | undefined {
  return entries.find((e) => e.superficie_id === surfaceId && e.tool === tool);
}

function directUrl(tool: Tool): string | undefined {
  const url = tool._meta?.[META_DIRECT_URL];
  return typeof url === 'string' ? url : undefined;
}

function refusal(name: string, verdict: Verdict & { allowed: false }, url: string | undefined): UvdError {
  return new UvdError(
    'refused',
    `uvd will not call ${name}: ${verdict.reason}. uvd 0.1 has no wallet and no credentials, so it only calls free read-only tools; paid, writing and authenticated calls arrive in a later version.${url ? ` Its direct endpoint is ${url}` : ''}`,
    EXIT.refused,
    { tool: name, class: verdict.toolClass, source: verdict.source, ...(url ? { url_mcp: url } : {}) },
  );
}

/** What `call` prints: the structured output if the tool gave one, otherwise its content blocks. */
export function callPayload(result: CallToolResult): unknown {
  return result.structuredContent ?? result.content;
}

export function callText(result: CallToolResult): string {
  const text = textOf(result);
  if (text) return text.endsWith('\n') ? text : `${text}\n`;
  return `${JSON.stringify(callPayload(result), null, 2)}\n`;
}
