import { META_SURFACE_ANNOTATIONS } from './emporium.ts';
import type { CatalogTool } from './emporium-client.ts';
import type { Tool } from './mcp.ts';

/**
 * Whether uvd 0.1 may call a tool. uvd has no wallet and no credentials, so it only calls free,
 * read-only tools, and every rule here fails closed: anything missing or unexpected is a refusal.
 * The first word is the class Emporium's catalog gives the tool (one of seven, returned by
 * `emporium_buscar_tool` as `por_que_no`). A catalog "free" never overrides annotations that say
 * otherwise, and tools the catalog does not classify (Emporium's own tools and combos) are judged
 * by their MCP annotations alone.
 */

/** The one class uvd 0.1 calls. */
export const FREE_CLASS = 'lectura';
/** The class of a tool whose catalog entry cannot be read. */
export const UNCLASSIFIED = 'sin_clasificar';

/** What each catalog class means, for the refusal message. */
const MEANING: Record<string, string> = {
  escribe: 'writes or changes state',
  mueve_dinero: 'moves money',
  riel_de_pago: 'is a payment rail',
  cobra_por_llamada: 'charges per call',
  pide_credencial: 'needs a credential',
  sin_clasificar: 'has not been classified',
};

/** Input properties that mean a tool takes a payment, compared in lower case. */
const PAYMENT_PROPERTIES = ['payment', 'paymentpayload', 'paymentrequirements', 'x-payment', 'x_payment'];

export type Verdict =
  | { allowed: true; source: Source; toolClass: string }
  | { allowed: false; source: Source; toolClass: string; reason: string };

type Source = 'catalog' | 'annotations' | 'surface' | 'counter';

const ALLOWED_BY_CATALOG: Verdict = { allowed: true, source: 'catalog', toolClass: FREE_CLASS };

/**
 * The catalog's verdict for `entry`. Allowed only if `por_que_no` is `lectura`, or if it is `null`
 * and the catalog says the tool is on the counter under exactly `counterName`. A known class other
 * than `lectura` is refused as that class; anything else (no field, `null` without a matching
 * counter name, a value of another type or an unknown class) is refused as `sin_clasificar`.
 */
export function fromCatalog(entry: CatalogTool, counterName: string | null): Verdict {
  const value: unknown = entry.por_que_no;
  if (value === FREE_CLASS) return ALLOWED_BY_CATALOG;
  if (value === null && counterName !== null && entry.en_el_mostrador === counterName) return ALLOWED_BY_CATALOG;
  if (typeof value === 'string' && Object.hasOwn(MEANING, value)) {
    return refused('catalog', value, `the Emporium catalog classifies it as "${value}": it ${MEANING[value]}`);
  }
  return refused(
    'catalog',
    UNCLASSIFIED,
    'the Emporium catalog gives it no class uvd can read, so it is treated as unclassified',
  );
}

/**
 * The objections a tool's own metadata raises, whatever the catalog says: a present set of
 * annotations (the counter's or the surface's) that does not say read-only or says destructive, or
 * an argument that carries a payment. `undefined` when there is none.
 */
export function annotationObjection(tool: Tool): Verdict | undefined {
  const sets = annotationSets(tool);
  if (sets.some((a) => a.readOnlyHint !== true)) {
    return refused('annotations', 'escribe', 'its MCP annotations do not declare it read-only');
  }
  if (sets.some((a) => a.destructiveHint === true)) {
    return refused('annotations', 'escribe', 'its MCP annotations declare it destructive');
  }
  const payment = paymentArgument(tool);
  if (payment)
    return refused('annotations', 'cobra_por_llamada', `it takes a \`${payment}\` argument: it charges per call`);
  return undefined;
}

/** The verdict for a tool the catalog does not classify: its annotations must exist and allow it. */
export function fromAnnotations(tool: Tool): Verdict {
  if (annotationSets(tool).length === 0) {
    return refused('annotations', 'escribe', 'it carries no MCP annotations that declare it read-only');
  }
  return annotationObjection(tool) ?? { allowed: true, source: 'annotations', toolClass: FREE_CLASS };
}

/** The name of the first input property that carries a payment, if any. */
export function paymentArgument(tool: Tool): string | undefined {
  const properties = tool.inputSchema?.properties;
  if (typeof properties !== 'object' || properties === null) return undefined;
  return Object.keys(properties).find((p) => {
    const name = p.toLowerCase();
    return PAYMENT_PROPERTIES.includes(name) || name.startsWith('x402');
  });
}

function annotationSets(tool: Tool): Record<string, unknown>[] {
  return [tool.annotations, tool._meta?.[META_SURFACE_ANNOTATIONS]].filter(
    (a): a is Record<string, unknown> => typeof a === 'object' && a !== null,
  );
}

export function refused(source: Source, toolClass: string, reason: string): Verdict {
  return { allowed: false, source, toolClass, reason };
}
