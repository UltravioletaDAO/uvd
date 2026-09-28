import { META_SURFACE_ANNOTATIONS } from './emporium.ts';
import type { CatalogTool } from './emporium-client.ts';
import type { Tool } from './mcp.ts';

/**
 * Whether uvd 0.1 may call a tool. uvd has no wallet and no credentials, so it only calls free,
 * read-only tools. The source of truth is the class Emporium's catalog gives the tool (one of seven,
 * returned by `emporium_buscar_tool` as `por_que_no`); the MCP annotations are only the fallback
 * for tools the catalog does not classify, such as Emporium's own tools and combos.
 */

/** The one class uvd 0.1 calls. */
export const FREE_CLASS = 'lectura';

/** What each catalog class means, for the refusal message. */
const MEANING: Record<string, string> = {
  escribe: 'writes or changes state',
  mueve_dinero: 'moves money',
  riel_de_pago: 'is a payment rail',
  cobra_por_llamada: 'charges per call',
  pide_credencial: 'needs a credential',
  sin_clasificar: 'has not been classified yet',
};

/** Input properties that mean a tool takes a payment (the ones the catalog excludes by name). */
const PAYMENT_PROPERTIES = ['payment', 'paymentPayload', 'paymentRequirements'];

export type Verdict =
  | { allowed: true; source: 'catalog' | 'annotations'; toolClass: string }
  | { allowed: false; source: 'catalog' | 'annotations'; toolClass: string; reason: string };

export function fromCatalog(entry: CatalogTool): Verdict {
  const toolClass = entry.por_que_no ?? FREE_CLASS;
  if (toolClass === FREE_CLASS) return { allowed: true, source: 'catalog', toolClass };
  return {
    allowed: false,
    source: 'catalog',
    toolClass,
    reason: `the Emporium catalog classifies it as "${toolClass}": it ${MEANING[toolClass] ?? 'is not a free read-only tool'}`,
  };
}

/**
 * The fallback: allowed only if every set of annotations the tool carries (the counter's and, for a
 * forwarded tool, the surface's own) says read-only and not destructive, and it takes no payment.
 */
export function fromAnnotations(tool: Tool): Verdict {
  const sets = [tool.annotations, tool._meta?.[META_SURFACE_ANNOTATIONS]].filter(
    (a): a is Record<string, unknown> => typeof a === 'object' && a !== null,
  );
  if (sets.length === 0 || sets.some((a) => a.readOnlyHint !== true)) {
    return refusedByAnnotations('escribe', 'its MCP annotations do not declare it read-only');
  }
  if (sets.some((a) => a.destructiveHint === true)) {
    return refusedByAnnotations('escribe', 'its MCP annotations declare it destructive');
  }
  const properties = Object.keys(tool.inputSchema?.properties ?? {});
  const payment = properties.find((p) => PAYMENT_PROPERTIES.includes(p));
  if (payment) {
    return refusedByAnnotations('cobra_por_llamada', `it takes a \`${payment}\` argument: it charges per call`);
  }
  return { allowed: true, source: 'annotations', toolClass: FREE_CLASS };
}

function refusedByAnnotations(toolClass: string, reason: string): Verdict {
  return { allowed: false, source: 'annotations', toolClass, reason };
}
