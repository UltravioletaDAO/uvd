import { EXIT, UvdError } from './errors.ts';

/**
 * Output rules (AGENTS.md): a readable table when stdout is a terminal; JSON when it is not, or with
 * `--json`. JSON is always a single line (an array or an object). Errors go to stderr, as JSON in
 * JSON mode.
 */
export type Format = 'json' | 'table';

export function resolveFormat(options: { json: boolean; isTTY: boolean }): Format {
  return options.json || !options.isTTY ? 'json' : 'table';
}

export interface Column {
  key: string;
  header: string;
  /** Columns that may shrink to fit the terminal; the others keep their width. */
  flexible?: boolean;
}

export type Row = Record<string, string>;

/** A plain-text table: a header, a rule, and one line per row, fitted to `width` if possible. */
export function renderTable(columns: Column[], rows: Row[], width = 100): string {
  const widths = columns.map((c) => Math.max(c.header.length, ...rows.map((r) => clean(r[c.key]).length)));
  const gap = 2;
  const total = () => widths.reduce((a, b) => a + b, 0) + gap * (columns.length - 1);
  // Shrink the flexible columns, widest first, until the table fits or they reach 12 characters.
  while (total() > width) {
    let widest = -1;
    columns.forEach((c, i) => {
      const w = widths[i] ?? 0;
      if (c.flexible && w > 12 && (widest < 0 || w > (widths[widest] ?? 0))) widest = i;
    });
    if (widest < 0) break;
    widths[widest] = Math.max(12, (widths[widest] ?? 0) - (total() - width));
  }
  const line = (cells: string[]) =>
    cells
      .map((cell, i) => fit(cell, widths[i] ?? 0))
      .join(' '.repeat(gap))
      .trimEnd();
  return [
    line(columns.map((c) => c.header)),
    line(widths.map((w) => '-'.repeat(w))),
    ...rows.map((r) => line(columns.map((c) => clean(r[c.key])))),
  ].join('\n');
}

function clean(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function fit(text: string, width: number): string {
  if (text.length <= width) return text.padEnd(width);
  return `${text.slice(0, Math.max(0, width - 1))}…`;
}

export function toJsonLine(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

/** What goes to stderr for an error, in either format. */
export function formatError(error: unknown, format: Format): { text: string; exitCode: number } {
  const uvd =
    error instanceof UvdError
      ? error
      : new UvdError('internal', error instanceof Error ? error.message : String(error), EXIT.internal);
  if (format === 'json') {
    const body: Record<string, unknown> = { code: uvd.code, message: uvd.message, exitCode: uvd.exitCode };
    if (uvd.details) body.details = uvd.details;
    return { text: toJsonLine({ error: body }), exitCode: uvd.exitCode };
  }
  return { text: `uvd: ${uvd.message}\n`, exitCode: uvd.exitCode };
}
