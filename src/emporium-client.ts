import type { ToolsCache } from './cache.ts';
import {
  COUNTER_PATH,
  endpoint,
  MCP_PATH,
  searchServiceArgs,
  searchToolArgs,
  surfacesArgs,
  TOOL_SEARCH_SERVICE,
  TOOL_SEARCH_TOOL,
  TOOL_SURFACES,
} from './emporium.ts';
import { EXIT, UvdError } from './errors.ts';
import { type CallToolResult, Connections, type Tool } from './mcp.ts';

/** A surface of Emporium's catalog, as `emporium_superficies` describes it. */
export interface Surface {
  id: string;
  nombre?: string;
  url_mcp: string;
  auth?: { tipo?: string; notas?: string };
  mueve_dinero?: boolean;
  reenviadas?: number;
  [key: string]: unknown;
}

/** One result of `emporium_buscar_tool`: where a tool lives and, if not on the counter, why. */
export interface CatalogTool {
  superficie_id: string;
  tool: string;
  url_mcp?: string;
  auth_tipo?: string;
  en_el_mostrador: string | null;
  por_que_no: string | null;
  [key: string]: unknown;
}

export interface ServiceSearch {
  candidatos: Record<string, unknown>[];
  hueco?: { por_que_no_hay?: string } | null;
  aviso?: string;
  [key: string]: unknown;
}

/** Emporium, seen from uvd: its own MCP (`/mcp`) and the counter (`/mostrador/mcp`). */
export class Emporium {
  readonly base: string;
  readonly cache: ToolsCache | null;
  readonly connections = new Connections();

  constructor(base: string, cache: ToolsCache | null) {
    this.base = base;
    this.cache = cache;
  }

  get mcpUrl(): string {
    return endpoint(this.base, MCP_PATH);
  }

  get counterUrl(): string {
    return endpoint(this.base, COUNTER_PATH);
  }

  /** tools/list of any MCP endpoint, through the cache unless it is disabled. */
  async listTools(url: string): Promise<Tool[]> {
    const cached = await this.cache?.get(url);
    if (cached) return cached;
    const tools = await this.connections.listTools(url);
    await this.cache?.set(url, tools);
    return tools;
  }

  async surfaces(): Promise<Surface[]> {
    const out = await this.#houseTool(TOOL_SURFACES, surfacesArgs());
    const list = out.superficies;
    if (!Array.isArray(list)) throw malformed(TOOL_SURFACES, 'superficies');
    return list.filter((s): s is Surface => isRecord(s) && typeof s.id === 'string' && typeof s.url_mcp === 'string');
  }

  /** `emporium_buscar_tool` as it answered: `resultados`, `combos`, `aviso`, `no_listables`… */
  async searchToolRaw(text: string): Promise<Record<string, unknown>> {
    const out = await this.#houseTool(TOOL_SEARCH_TOOL, searchToolArgs(text));
    if (!Array.isArray(out.resultados)) throw malformed(TOOL_SEARCH_TOOL, 'resultados');
    return out;
  }

  /** The catalog entries `emporium_buscar_tool` finds for `text`. */
  async searchTool(text: string): Promise<CatalogTool[]> {
    const list = (await this.searchToolRaw(text)).resultados as unknown[];
    return list.filter(
      (r): r is CatalogTool => isRecord(r) && typeof r.superficie_id === 'string' && typeof r.tool === 'string',
    );
  }

  async searchService(query: string): Promise<ServiceSearch> {
    const out = await this.#houseTool(TOOL_SEARCH_SERVICE, searchServiceArgs(query));
    if (!Array.isArray(out.candidatos)) throw malformed(TOOL_SEARCH_SERVICE, 'candidatos');
    return out as ServiceSearch;
  }

  callCounter(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    return this.connections.callTool(this.counterUrl, name, args);
  }

  close(): Promise<void> {
    return this.connections.close();
  }

  /** Calls one of Emporium's own tools on `/mcp` and returns its structured output. */
  async #houseTool(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const result = await this.connections.callTool(this.mcpUrl, name, args);
    if (result.isError) {
      throw new UvdError('tool_error', `${name} failed: ${textOf(result) || 'no details'}`, EXIT.remote);
    }
    const structured = result.structuredContent ?? parseText(result);
    if (!isRecord(structured)) throw malformed(name, 'structuredContent');
    return structured;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The text blocks of a tool result, joined. */
export function textOf(result: CallToolResult): string {
  return result.content
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
}

function parseText(result: CallToolResult): unknown {
  try {
    return JSON.parse(textOf(result));
  } catch {
    return undefined;
  }
}

function malformed(tool: string, field: string): UvdError {
  return new UvdError('unexpected_response', `${tool} answered without a valid \`${field}\``, EXIT.remote);
}
