// A local MCP server (Streamable HTTP, JSON responses, stateless) that answers with the fixtures in
// test/fixtures/. Tests point UVD_EMPORIUM_URL at it; nothing here touches the network.
//
// What it serves:
// - test/fixtures/emporium/: exchanges recorded from Emporium by scripts/record-fixtures.ts,
//   matched by endpoint, JSON-RPC method, tool name and arguments, and returned as recorded (only
//   the JSON-RPC `id` is the caller's).
// - test/fixtures/derived/: exchanges derived from a recorded one (each file says from which and
//   why). Served only when a test asks for them.
// - test/fixtures/synthetic/: hand-written data, clearly labeled. Served only when a test asks.
//
// Options are read on every request, so a test may change them between two runs of uvd.
//
// One rewrite always happens: the `url_mcp` of every surface in `emporium_superficies` (and
// `mostrador_url`) points back at this server, under /surfaces/<id>/mcp, so a test that follows a
// surface URL stays on 127.0.0.1.

import { readdirSync, readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

type Json = Record<string, unknown>;

interface Exchange {
  endpoint: string;
  request: { method: string; params?: Json };
  response: { status: number; contentType: string | null; body: Json | null };
}

export interface RecordedRequest {
  path: string;
  httpMethod: string;
  userAgent: string | undefined;
  rpcMethod?: string;
  tool?: string;
  arguments?: Json;
  matched: boolean;
}

export interface FixtureServerOptions {
  /** Files of test/fixtures/derived/ to serve too (by file name). */
  derived?: string[];
  /** Surfaces appended to `emporium_superficies`. */
  extraSurfaces?: Json[];
  /** Tools appended to the counter's tools/list. */
  extraCounterTools?: Json[];
  /** tools/list of /surfaces/<id>/mcp, by surface id. */
  surfaceTools?: Record<string, Json[]>;
  /** Result for a counter tools/call that has no recorded fixture, by tool name. */
  counterResults?: Record<string, Json>;
  /** `emporium_buscar_tool` structured answers with no recorded fixture, by `texto`. */
  catalog?: Record<string, Json>;
  /** Port to listen on; 0 (the default) picks a free one. */
  port?: number;
}

export interface FixtureServer {
  url: string;
  requests: RecordedRequest[];
  close(): Promise<void>;
}

const FIXTURES = join(import.meta.dirname, '..', 'fixtures');
export const SURFACES_TOOL = 'emporium_superficies';
const SEARCH_TOOL_TOOL = 'emporium_buscar_tool';

export function loadExchanges(dir: string, only?: string[]): Exchange[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json') && f !== 'manifest.json' && (!only || only.includes(f)))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as Exchange);
}

export function loadSynthetic<T = Json>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURES, 'synthetic', name), 'utf8')) as T;
}

/** A canonical key: object keys sorted, so `{"a":1,"b":2}` and `{"b":2,"a":1}` match. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Json).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function keyOf(endpoint: string, method: string, params: Json | undefined): string {
  if (method === 'initialize') return `${endpoint}|initialize`;
  if (method === 'tools/call') {
    return `${endpoint}|tools/call|${String(params?.name)}|${canonical(params?.arguments ?? {})}`;
  }
  return `${endpoint}|${method}|${canonical(params?.cursor ?? null)}`;
}

export async function startFixtureServer(options: FixtureServerOptions = {}): Promise<FixtureServer> {
  const exchanges = [
    ...loadExchanges(join(FIXTURES, 'emporium')),
    ...(options.derived ? loadExchanges(join(FIXTURES, 'derived'), options.derived) : []),
  ];
  const byKey = new Map(exchanges.map((e) => [keyOf(e.endpoint, e.request.method, e.request.params), e]));
  const initialize = byKey.get('/mcp|initialize');
  const requests: RecordedRequest[] = [];
  let base = '';

  const server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end(String(error));
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    const record: RecordedRequest = {
      path,
      httpMethod: req.method ?? '',
      userAgent: req.headers['user-agent'],
      matched: false,
    };
    requests.push(record);
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'POST' }).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const message = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Json;
    const method = String(message.method);
    const params = message.params as Json | undefined;
    record.rpcMethod = method;
    if (method === 'tools/call') {
      record.tool = String(params?.name);
      record.arguments = (params?.arguments as Json | undefined) ?? {};
    }
    if (message.id === undefined) {
      record.matched = true;
      res.writeHead(202).end();
      return;
    }

    const surface = /^\/surfaces\/([^/]+)\/mcp$/.exec(path);
    let result: Json | undefined;
    let error: Json | undefined;
    if (surface) {
      const id = decodeURIComponent(surface[1] ?? '');
      if (method === 'initialize') result = (initialize?.response.body?.result as Json | undefined) ?? {};
      else if (method === 'tools/list' && options.surfaceTools?.[id]) result = { tools: options.surfaceTools[id] };
    } else {
      const exchange = byKey.get(keyOf(path, method, params));
      if (exchange?.response.body) {
        result = exchange.response.body.result as Json | undefined;
        error = exchange.response.body.error as Json | undefined;
      } else if (method === 'tools/call' && path === '/mostrador/mcp') {
        result = options.counterResults?.[String(params?.name)];
      } else if (method === 'tools/call' && path === '/mcp' && params?.name === SEARCH_TOOL_TOOL) {
        const answer = options.catalog?.[String((params.arguments as Json | undefined)?.texto)];
        if (answer) result = { content: [{ type: 'text', text: JSON.stringify(answer) }], structuredContent: answer };
      }
      if (result && path === '/mostrador/mcp' && method === 'tools/list' && options.extraCounterTools) {
        result = { ...result, tools: [...(result.tools as Json[]), ...options.extraCounterTools] };
      }
      if (result && method === 'tools/call' && params?.name === SURFACES_TOOL) result = rewriteSurfaces(result);
    }

    record.matched = result !== undefined || error !== undefined;
    const body: Json = { jsonrpc: '2.0', id: message.id };
    if (result !== undefined) body.result = result;
    else body.error = error ?? { code: -32001, message: `uvd fixture server: no fixture for ${method} ${path}` };
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  }

  /** Points every surface URL back at this server and appends the extra surfaces. */
  function rewriteSurfaces(result: Json): Json {
    const out = structuredClone(result);
    const structured = out.structuredContent as Json | undefined;
    if (!structured) return out;
    const surfaces = [...((structured.superficies as Json[] | undefined) ?? []), ...(options.extraSurfaces ?? [])];
    structured.superficies = surfaces.map((s) => ({
      ...s,
      url_mcp: `${base}/surfaces/${encodeURIComponent(String(s.id))}/mcp`,
    }));
    structured.total = surfaces.length;
    if (typeof structured.mostrador_url === 'string') structured.mostrador_url = `${base}/mostrador/mcp`;
    out.content = [{ type: 'text', text: JSON.stringify(structured) }];
    return out;
  }

  await new Promise<void>((resolve) => server.listen(options.port ?? 0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url: base,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
