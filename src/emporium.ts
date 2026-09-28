// Everything uvd knows about Emporium's MCP surface lives here: the paths, the tool names and the
// exact arguments the CLI sends. scripts/record-fixtures.ts imports the same builders, so the
// recorded fixtures match the requests the CLI makes byte for byte.

export const DEFAULT_EMPORIUM_URL = 'https://emporium.ultravioletadao.xyz';

/** Emporium's own MCP endpoint: the discovery tools. */
export const MCP_PATH = '/mcp';
/** The counter ("mostrador"): free read-only tools of the catalog surfaces, forwarded. */
export const COUNTER_PATH = '/mostrador/mcp';

export const TOOL_SEARCH_SERVICE = 'emporium_buscar_servicio';
export const TOOL_SEARCH_TOOL = 'emporium_buscar_tool';
export const TOOL_SURFACES = 'emporium_superficies';

/** `emporium_buscar_tool` accepts 1..=50 results; uvd always asks for the maximum. */
export const SEARCH_TOOL_LIMIT = 50;

export function searchServiceArgs(query: string): Record<string, unknown> {
  return { q: query };
}

export function searchToolArgs(text: string): Record<string, unknown> {
  return { texto: text, limite: SEARCH_TOOL_LIMIT };
}

export function surfacesArgs(): Record<string, unknown> {
  return {};
}

/** `_meta` keys the counter puts on every forwarded tool. */
export const META_SURFACE = 'emporium/superficie';
export const META_TOOL = 'emporium/tool';
export const META_DIRECT_URL = 'emporium/url_mcp_directa';
export const META_SURFACE_ANNOTATIONS = 'emporium/anotaciones_de_la_superficie';

/** Joins a base URL and a path without doubling or dropping slashes. */
export function endpoint(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}${path}`;
}
