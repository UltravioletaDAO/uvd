import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport, StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { type CallToolResult, ErrorCode, McpError, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { publicEndpoint } from './cache.ts';
import { EXIT, UvdError } from './errors.ts';
import { USER_AGENT, VERSION } from './version.ts';

export type { CallToolResult, Tool };

/**
 * Every request uvd makes goes through here: it carries uvd's User-Agent and never follows a
 * redirect (an endpoint that redirects is an error, not a hop to somewhere else).
 */
export const userAgentFetch: typeof fetch = (input, init) => {
  const headers = new Headers(init?.headers);
  headers.set('user-agent', USER_AGENT);
  return fetch(input, { ...init, headers, redirect: 'error' });
};

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * MCP clients, one per endpoint URL, opened on first use and closed together. A command that talks
 * to the same endpoint twice (a lookup, then a call) initializes it once.
 */
export class Connections {
  readonly #clients = new Map<string, Promise<Client>>();

  client(url: string): Promise<Client> {
    let pending = this.#clients.get(url);
    if (!pending) {
      pending = connect(url);
      this.#clients.set(url, pending);
    }
    return pending;
  }

  async listTools(url: string): Promise<Tool[]> {
    const client = await this.client(url);
    const tools: Tool[] = [];
    let cursor: string | undefined;
    do {
      const page = await guard(url, () =>
        client.listTools(cursor === undefined ? undefined : { cursor }, { timeout: REQUEST_TIMEOUT_MS }),
      );
      tools.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor !== undefined);
    return tools;
  }

  async callTool(url: string, name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    const client = await this.client(url);
    return (await guard(url, () =>
      client.callTool({ name, arguments: args }, undefined, { timeout: REQUEST_TIMEOUT_MS }),
    )) as CallToolResult;
  }

  async close(): Promise<void> {
    const clients = await Promise.allSettled(this.#clients.values());
    this.#clients.clear();
    await Promise.allSettled(clients.map((c) => (c.status === 'fulfilled' ? c.value.close() : undefined)));
  }
}

async function connect(url: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(url), { fetch: userAgentFetch });
  const client = new Client({ name: 'uvd', version: VERSION });
  await guard(url, () => client.connect(transport, { timeout: REQUEST_TIMEOUT_MS }));
  return client;
}

/** Runs one MCP exchange and turns whatever it throws into a UvdError with a stable code. */
async function guard<T>(url: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw toUvdError(url, error);
  }
}

export function toUvdError(url: string, error: unknown): UvdError {
  if (error instanceof UvdError) return error;
  const where = publicEndpoint(url);
  if (error instanceof StreamableHTTPError && typeof error.code === 'number') {
    if (error.code === 401 || error.code === 403) {
      return new UvdError(
        'credential_required',
        `${where} asked for a credential (HTTP ${error.code}). uvd 0.1 has no credentials; authenticated calls arrive in a later version.`,
        EXIT.refused,
        { endpoint: where, status: error.code },
      );
    }
    return new UvdError('http_error', `${where} answered HTTP ${error.code}`, EXIT.remote, {
      endpoint: where,
      status: error.code,
    });
  }
  if (error instanceof McpError) {
    const code = error.code === ErrorCode.InvalidParams ? 'invalid_params' : 'mcp_error';
    return new UvdError(code, `${where}: ${error.message}`, code === 'invalid_params' ? EXIT.usage : EXIT.remote, {
      endpoint: where,
      mcpCode: error.code,
    });
  }
  const cause = (error as { cause?: { code?: unknown } } | undefined)?.cause?.code;
  const message = error instanceof Error ? error.message : String(error);
  return new UvdError(
    'unreachable',
    `could not reach ${where}: ${typeof cause === 'string' ? cause : message}`,
    EXIT.remote,
    { endpoint: where },
  );
}
