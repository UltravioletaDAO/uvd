// Records the Emporium fixtures the test suite serves. It runs by hand, rarely:
//
//   node scripts/record-fixtures.ts --dry-run   # print what it would request, touch nothing
//   node scripts/record-fixtures.ts             # record the fixtures that are missing
//   node scripts/record-fixtures.ts --fresh     # delete test/fixtures/emporium/ and record it all
//
// It never overwrites a fixture: a step whose file already exists is skipped, and what later steps
// need from it (the negotiated protocol version, the counter's tool list) is read from that file.
// It is sequential, pauses 1 s between requests, sends uvd's own User-Agent and talks only to
// Emporium (`/mcp` and `/mostrador/mcp`, or UVD_EMPORIUM_URL). It only calls Emporium's own tools,
// which read Emporium's embedded catalog and index and never reach another surface. Tests never go
// to the network: test/helpers/fixture-server.ts serves what this script writes.

import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import {
  COUNTER_PATH,
  DEFAULT_EMPORIUM_URL,
  endpoint,
  MCP_PATH,
  META_SURFACE,
  META_TOOL,
  searchServiceArgs,
  searchToolArgs,
  surfacesArgs,
  TOOL_SEARCH_SERVICE,
  TOOL_SEARCH_TOOL,
  TOOL_SURFACES,
} from '../src/emporium.ts';
import { USER_AGENT, VERSION } from '../src/version.ts';

const OUT_DIR = join(import.meta.dirname, '..', 'test', 'fixtures', 'emporium');
const MANIFEST = join(OUT_DIR, 'manifest.json');
const PAUSE_MS = 1000;
/** `emporium_buscar_servicio` queries (third-party services). */
const SERVICE_QUERIES = ['reputacion', 'pagos', 'lookup_wallet', 'wallet'];
/** `emporium_buscar_tool` queries (tools of the stack), as `uvd search` sends them. */
const TOOL_QUERIES = ['reputacion', 'wallet'];
/** A tool the catalog is known to classify as paid (describe-net charges per call for it). */
const PAID_PROBE = 'lookup_wallet';

type Json = Record<string, unknown>;

interface Exchange {
  endpoint: string;
  request: { method: string; params?: Json };
  response: { status: number; contentType: string | null; body: Json | null };
}

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const base = process.env.UVD_EMPORIUM_URL ?? DEFAULT_EMPORIUM_URL;
let requestId = 0;
let requests = 0;
const protocolByPath = new Map<string, string>();
const written: string[] = [];

function fixturePath(name: string): string {
  return join(OUT_DIR, `${name}.json`);
}

async function readFixture(name: string): Promise<Exchange> {
  return JSON.parse(await readFile(fixturePath(name), 'utf8')) as Exchange;
}

async function post(path: string, method: string, params?: Json, notification = false): Promise<Exchange> {
  if (dryRun) {
    console.error(`[dry-run] POST ${path} ${method} ${params === undefined ? '' : JSON.stringify(params)}`);
    requests += 1;
    return { endpoint: path, request: { method }, response: { status: 0, contentType: null, body: null } };
  }
  if (requests > 0) await sleep(PAUSE_MS);
  requests += 1;
  const body: Json = { jsonrpc: '2.0', method };
  if (params !== undefined) body.params = params;
  if (!notification) body.id = ++requestId;
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'user-agent': USER_AGENT,
  };
  const protocol = protocolByPath.get(path);
  if (protocol) headers['mcp-protocol-version'] = protocol;
  const res = await fetch(endpoint(base, path), { method: 'POST', headers, body: JSON.stringify(body) });
  const contentType = res.headers.get('content-type');
  const text = await res.text();
  const exchange: Exchange = {
    endpoint: path,
    request: params === undefined ? { method } : { method, params },
    response: { status: res.status, contentType, body: parseBody(text, contentType) },
  };
  console.error(`${method} ${path} -> ${res.status}`);
  if (!notification && (res.status !== 200 || exchange.response.body === null)) {
    throw new Error(`${method} ${path}: HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return exchange;
}

function parseBody(text: string, contentType: string | null): Json | null {
  if (text.trim() === '') return null;
  if (contentType?.includes('text/event-stream')) {
    const data = text
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .filter((line) => line !== '');
    const last = data.at(-1);
    return last === undefined ? null : (JSON.parse(last) as Json);
  }
  return JSON.parse(text) as Json;
}

async function save(name: string, exchange: Exchange): Promise<void> {
  if (dryRun) return;
  await writeFile(fixturePath(name), `${JSON.stringify(exchange, null, 2)}\n`, { flag: 'wx' });
  written.push(`${name}.json`);
}

function result(exchange: Exchange): Json {
  const body = exchange.response.body;
  if (body === null || typeof body.result !== 'object' || body.result === null) {
    throw new Error(`${exchange.request.method} ${exchange.endpoint}: no JSON-RPC result`);
  }
  return body.result as Json;
}

/** Runs one recording step unless its fixture exists; returns the recorded (or existing) exchange. */
async function step(name: string, record: () => Promise<Exchange>): Promise<Exchange | null> {
  if (existsSync(fixturePath(name))) return readFixture(name);
  const exchange = await record();
  await save(name, exchange);
  return dryRun ? null : exchange;
}

async function initialize(path: string, prefix: string): Promise<Json | null> {
  const name = `${prefix}.initialize`;
  const fresh = !existsSync(fixturePath(name));
  const init = await step(name, () =>
    post(path, 'initialize', {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'uvd', version: VERSION },
    }),
  );
  if (init === null) return null;
  const negotiated = result(init).protocolVersion;
  if (typeof negotiated === 'string') protocolByPath.set(path, negotiated);
  if (fresh) await post(path, 'notifications/initialized', undefined, true);
  return result(init);
}

async function listTools(path: string, prefix: string): Promise<Json[]> {
  const tools: Json[] = [];
  let cursor: string | undefined;
  let page = 1;
  do {
    const exchange = await step(page === 1 ? `${prefix}.tools-list` : `${prefix}.tools-list.page${page}`, () =>
      post(path, 'tools/list', cursor === undefined ? undefined : { cursor }),
    );
    if (exchange === null) return tools;
    const res = result(exchange);
    tools.push(...((res.tools as Json[] | undefined) ?? []));
    cursor = typeof res.nextCursor === 'string' ? res.nextCursor : undefined;
    page += 1;
  } while (cursor !== undefined);
  return tools;
}

async function callTool(path: string, name: string, toolArgs: Json, file: string): Promise<void> {
  await step(file, () => post(path, 'tools/call', { name, arguments: toolArgs }));
}

function isExecutionMarket(tool: Json): boolean {
  const meta = (tool._meta ?? {}) as Json;
  return JSON.stringify([meta[META_SURFACE], meta['emporium/url_mcp_directa']]).includes('execution');
}

async function main(): Promise<void> {
  if (args.has('--fresh') && !dryRun) await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  const mcpInit = await initialize(MCP_PATH, 'mcp');
  await listTools(MCP_PATH, 'mcp');
  await callTool(MCP_PATH, TOOL_SURFACES, surfacesArgs(), `mcp.call.${TOOL_SURFACES}`);
  for (const query of SERVICE_QUERIES) {
    await callTool(MCP_PATH, TOOL_SEARCH_SERVICE, searchServiceArgs(query), `mcp.call.${TOOL_SEARCH_SERVICE}.${query}`);
  }

  await initialize(COUNTER_PATH, 'counter');
  const counterTools = await listTools(COUNTER_PATH, 'counter');
  // A real `uvd call` against the counter, with a house tool: it reads Emporium's embedded catalog
  // and never reaches another surface.
  await callTool(COUNTER_PATH, TOOL_SURFACES, surfacesArgs(), `counter.call.${TOOL_SURFACES}`);

  // What `uvd search` asks the catalog, and the catalog class of one forwarded (free, read-only)
  // tool and of one paid tool.
  const forwarded = counterTools.find((t) => (t._meta as Json | undefined)?.[META_TOOL] && !isExecutionMarket(t));
  const probes = [...TOOL_QUERIES, PAID_PROBE];
  if (forwarded) probes.unshift(String((forwarded._meta as Json)[META_TOOL]));
  for (const probe of new Set(probes)) {
    await callTool(MCP_PATH, TOOL_SEARCH_TOOL, searchToolArgs(probe), `mcp.call.${TOOL_SEARCH_TOOL}.${probe}`);
  }

  if (dryRun) {
    console.error(`[dry-run] ${requests} requests would be made`);
    return;
  }
  const previous = existsSync(MANIFEST) ? (JSON.parse(await readFile(MANIFEST, 'utf8')) as Json) : {};
  const sessions = Array.isArray(previous.sessions) ? previous.sessions : [];
  if (written.length > 0) {
    sessions.push({ recordedAt: new Date().toISOString(), base, userAgent: USER_AGENT, requests, files: written });
  }
  const manifest = {
    note: 'Recorded from Emporium by scripts/record-fixtures.ts. Never edited by hand.',
    serverInfo: mcpInit?.serverInfo ?? previous.serverInfo,
    pauseMs: PAUSE_MS,
    forwardedProbe: forwarded ? { name: forwarded.name, tool: (forwarded._meta as Json)[META_TOOL] } : null,
    paidProbe: PAID_PROBE,
    sessions,
  };
  await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  console.error(`recorded ${written.length} fixtures in ${requests} requests`);
}

await main();
