import { parseArgs } from 'node:util';
import { ToolsCache } from './cache.ts';
import { call, callPayload, callText } from './commands/call.ts';
import { search, searchTable } from './commands/search.ts';
import { tools, toolsTable } from './commands/tools.ts';
import { cacheDir, cacheTtlMs, emporiumBaseUrl } from './config.ts';
import { Emporium } from './emporium-client.ts';
import { EXIT, usage } from './errors.ts';
import { type Format, formatError, resolveFormat, toJsonLine } from './output.ts';
import { VERSION } from './version.ts';

const HELP = `uvd ${VERSION} — the Ultravioleta DAO command line

Usage:
  uvd search <text>                 Search Emporium: tools of the stack and third-party services
  uvd tools [service]               List Emporium's MCP tools, or the tools of a catalog service
  uvd call <tool> [--input JSON]    Call a free read-only tool through Emporium's counter
                                    (--input '{"key":"value"}', or --input - to read stdin)

Options:
  --json        JSON output (the default when stdout is not a terminal)
  --no-cache    Do not read or write the tools/list cache
  -h, --help    Show this help
  -V, --version Print the version

Environment:
  UVD_EMPORIUM_URL   Emporium base URL (default https://emporium.ultravioletadao.xyz)
  UVD_CACHE_DIR      Cache directory (default: the user cache directory)
  UVD_CACHE_TTL      tools/list cache lifetime in seconds (default 600)

Exit codes: 0 ok, 1 internal error, 2 usage, 3 network or remote error, 4 not found,
5 refused (needs a wallet or a credential: later version), 6 the tool returned an error.
See AGENTS.md for the JSON contract.
`;

export interface Io {
  argv: string[];
  env: Record<string, string | undefined>;
  stdout: NodeJS.WritableStream & { isTTY?: boolean; columns?: number };
  stderr: NodeJS.WritableStream;
  readStdin: () => Promise<string>;
}

export async function main(io: Io): Promise<number> {
  let format: Format = resolveFormat({ json: io.argv.includes('--json'), isTTY: io.stdout.isTTY === true });
  let emporium: Emporium | undefined;
  try {
    const { values, positionals } = parseArgs({
      args: io.argv,
      allowPositionals: true,
      strict: true,
      options: {
        json: { type: 'boolean', default: false },
        'no-cache': { type: 'boolean', default: false },
        input: { type: 'string' },
        help: { type: 'boolean', short: 'h', default: false },
        version: { type: 'boolean', short: 'V', default: false },
      },
    });
    format = resolveFormat({ json: values.json, isTTY: io.stdout.isTTY === true });
    if (values.version) {
      io.stdout.write(`${VERSION}\n`);
      return EXIT.ok;
    }
    if (values.help) {
      io.stdout.write(HELP);
      return EXIT.ok;
    }
    const [command, ...rest] = positionals;
    if (command === undefined) throw usage('missing command. Run `uvd --help`.');
    if (values.input !== undefined && command !== 'call') throw usage('--input only applies to `uvd call`');

    const cache = values['no-cache'] ? null : new ToolsCache(cacheDir(io.env), cacheTtlMs(io.env));
    const width = io.stdout.columns || 100;

    switch (command) {
      case 'search': {
        const text = rest.join(' ').trim();
        if (text.length < 2) throw usage('`uvd search` needs a text of at least 2 characters');
        emporium = new Emporium(emporiumBaseUrl(io.env), cache);
        const outcome = await search(emporium, text);
        if (format === 'json') {
          io.stdout.write(toJsonLine(outcome.items));
          if (Object.keys(outcome.notices).length > 0) io.stderr.write(toJsonLine({ aviso: outcome.notices }));
        } else {
          io.stdout.write(searchTable(outcome, width));
        }
        return EXIT.ok;
      }
      case 'tools': {
        if (rest.length > 1) throw usage('`uvd tools` takes at most one service');
        emporium = new Emporium(emporiumBaseUrl(io.env), cache);
        const list = await tools(emporium, rest[0]);
        io.stdout.write(format === 'json' ? toJsonLine(list) : toolsTable(list, width));
        return EXIT.ok;
      }
      case 'call': {
        if (rest.length !== 1) throw usage('`uvd call` takes exactly one tool name');
        const input = parseInput(values.input === '-' ? await io.readStdin() : values.input);
        emporium = new Emporium(emporiumBaseUrl(io.env), cache);
        const result = await call(emporium, rest[0] as string, input);
        io.stdout.write(format === 'json' ? toJsonLine(callPayload(result)) : callText(result));
        return EXIT.ok;
      }
      default:
        throw usage(`unknown command "${command}". Run \`uvd --help\`.`);
    }
  } catch (error) {
    const { text, exitCode } = formatError(asUsageError(error), format);
    io.stderr.write(text);
    return exitCode;
  } finally {
    await emporium?.close();
  }
}

function parseInput(raw: string | undefined): Record<string, unknown> {
  if (raw === undefined) return {};
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw usage('--input is not valid JSON');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw usage('--input must be a JSON object');
  }
  return value as Record<string, unknown>;
}

/** `util.parseArgs` throws plain errors with an ERR_PARSE_ARGS_* code: those are usage errors. */
function asUsageError(error: unknown): unknown {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && code.startsWith('ERR_PARSE_ARGS')) return usage((error as Error).message);
  return error;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

process.exitCode = await main({
  argv: process.argv.slice(2),
  env: process.env,
  stdout: process.stdout,
  stderr: process.stderr,
  readStdin,
});
