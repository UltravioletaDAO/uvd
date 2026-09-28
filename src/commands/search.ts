import { TOOL_SEARCH_SERVICE, TOOL_SEARCH_TOOL } from '../emporium.ts';
import { type Emporium, isRecord } from '../emporium-client.ts';
import { renderTable, stripControl } from '../output.ts';

/** One search hit: Emporium's fields as they came, tagged with where they came from. */
export type SearchItem = { tipo: 'tool' | 'combo' | 'servicio' } & Record<string, unknown>;

export interface SearchOutcome {
  items: SearchItem[];
  /** What each search said besides its results (`aviso`, `no_listables`, `hueco`). Never dropped. */
  notices: Record<string, Record<string, unknown>>;
}

/**
 * `uvd search <text>`: the tools of the stack (`emporium_buscar_tool`) and the third-party services
 * (`emporium_buscar_servicio`), one after the other, in one list.
 */
export async function search(emporium: Emporium, text: string): Promise<SearchOutcome> {
  const tools = await emporium.searchToolRaw(text);
  const services = await emporium.searchService(text);
  const items: SearchItem[] = [
    ...records(tools.resultados).map((r) => ({ tipo: 'tool' as const, ...r })),
    ...records(tools.combos).map((c) => ({ tipo: 'combo' as const, ...c })),
    ...records(services.candidatos).map((c) => ({ tipo: 'servicio' as const, ...c })),
  ];
  const notices: SearchOutcome['notices'] = {};
  const toolNotice = pick(tools, ['aviso', 'no_listables']);
  if (toolNotice) notices[TOOL_SEARCH_TOOL] = toolNotice;
  const serviceNotice = pick(services, ['aviso', 'hueco']);
  if (serviceNotice) notices[TOOL_SEARCH_SERVICE] = serviceNotice;
  return { items, notices };
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function pick(source: Record<string, unknown>, keys: string[]): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const value = source[key];
    if (value === null || value === undefined || value === '') continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function searchTable({ items, notices }: SearchOutcome, width: number): string {
  const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
  const tools = items.filter((i) => i.tipo === 'tool');
  const combos = items.filter((i) => i.tipo === 'combo');
  const services = items.filter((i) => i.tipo === 'servicio');
  const out: string[] = [`Tools of the stack (${TOOL_SEARCH_TOOL})`];
  out.push(
    tools.length === 0
      ? '(none)'
      : renderTable(
          [
            { key: 'surface', header: 'SURFACE' },
            { key: 'tool', header: 'TOOL' },
            { key: 'call', header: 'CALL AS (uvd call)', flexible: true },
            { key: 'description', header: 'DESCRIPTION', flexible: true },
          ],
          tools.map((t) => ({
            surface: str(t.superficie_id),
            tool: str(t.tool),
            call: t.en_el_mostrador ? str(t.en_el_mostrador) : `not callable: ${str(t.por_que_no)}`,
            description: str(t.descripcion_corta),
          })),
          width,
        ),
  );
  if (combos.length > 0) {
    out.push('', 'Combos on the counter');
    out.push(
      renderTable(
        [
          { key: 'name', header: 'NAME' },
          { key: 'id', header: 'ID' },
          { key: 'form', header: 'FORM' },
        ],
        combos.map((c) => ({ name: str(c.nombre), id: str(c.id), form: str(c.forma) })),
        width,
      ),
    );
  }
  out.push('', `Third-party services (${TOOL_SEARCH_SERVICE})`);
  out.push(
    services.length === 0
      ? '(none)'
      : renderTable(
          [
            { key: 'name', header: 'SERVICE' },
            { key: 'url', header: 'URL', flexible: true },
            { key: 'score', header: 'SCORE' },
          ],
          services.map((s) => ({
            name: str(s.rotulo ?? s.slug ?? s.host),
            url: str(s.url ?? s.url_mcp),
            score: str(s.puntaje),
          })),
          width,
        ),
  );
  const notes = noticeLines(notices);
  if (notes.length > 0) out.push('', 'Notes:', ...notes.map((n) => `- ${stripControl(n)}`));
  return `${out.join('\n')}\n`;
}

function noticeLines(notices: SearchOutcome['notices']): string[] {
  const lines: string[] = [];
  for (const [tool, notice] of Object.entries(notices)) {
    if (typeof notice.aviso === 'string') lines.push(`${tool}: ${notice.aviso}`);
    if (Array.isArray(notice.no_listables)) {
      lines.push(`${tool}: surfaces that need a credential and are not indexed: ${notice.no_listables.join(', ')}`);
    }
    if (isRecord(notice.hueco) && notice.hueco.por_que_no_hay) {
      lines.push(`${tool}: no results (${String(notice.hueco.por_que_no_hay)})`);
    }
  }
  return lines;
}
