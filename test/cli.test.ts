import assert from 'node:assert/strict';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import pkg from '../package.json' with { type: 'json' };
import { type FixtureServer, loadSynthetic, startFixtureServer } from './helpers/fixture-server.ts';
import { runCli, tempCacheDir } from './helpers/run.ts';

type Json = Record<string, unknown>;

const USER_AGENT = `uvd/${pkg.version} (+https://github.com/UltravioletaDAO/uvd)`;
const newSurface = loadSynthetic<{ surface: Json; noAuthSurface: Json; tools: Json[] }>('new-surface.json');
const counterTools = loadSynthetic<Record<string, Json>>('counter-tools.json');
const catalog = loadSynthetic<{ answers: Record<string, Json> }>('catalog.json').answers;

let server: FixtureServer;

before(async () => {
  server = await startFixtureServer({
    derived: ['mcp.call.emporium_buscar_tool.describe_lookup_wallet.json'],
    extraSurfaces: [newSurface.surface, newSurface.noAuthSurface],
    surfaceTools: {
      [String(newSurface.surface.id)]: newSurface.tools,
      [String(newSurface.noAuthSurface.id)]: newSurface.tools,
    },
    extraCounterTools: [
      'paidForwarded',
      'notReadOnly',
      'takesPayment',
      'unclassified',
      'nullNotOnCounter',
      'lecturaDestructive',
      'lecturaWrites',
      'lecturaPayment',
      'credentialSurface',
      'unknownSurface',
    ].map((key) => counterTools[key] as Json),
    counterResults: { '402milly_get_grid_metadata': counterTools.forwardedResult as Json },
    catalog,
  });
});

after(() => server.close());

/** Runs uvd against the fixture server with a fresh cache; returns the run and the new requests. */
async function uvd(args: string[], options: { cache?: string; stdin?: string; env?: Record<string, string> } = {}) {
  const from = server.requests.length;
  const run = await runCli(
    args,
    { UVD_EMPORIUM_URL: server.url, UVD_CACHE_DIR: options.cache ?? tempCacheDir(), ...options.env },
    options.stdin,
  );
  return { ...run, requests: server.requests.slice(from) };
}

const toolCalls = (requests: FixtureServer['requests'], name?: string) =>
  requests.filter((r) => r.rpcMethod === 'tools/call' && (name === undefined || r.tool === name));

const errorOf = (stderr: string) => (JSON.parse(stderr) as { error: Json }).error;

describe('uvd --version and usage', () => {
  it('prints the package version', async () => {
    const run = await uvd(['--version']);
    assert.equal(run.code, 0);
    assert.equal(run.stdout, `${pkg.version}\n`);
    assert.equal(pkg.version, '0.1.0');
  });

  it('reports usage errors as JSON on stderr with exit 2 when stdout is not a terminal', async () => {
    for (const args of [[], ['frobnicate'], ['search'], ['call'], ['call', 'x', '--input', '{nope'], ['--bogus']]) {
      const run = await uvd(args);
      assert.equal(run.code, 2, args.join(' '));
      assert.equal(run.stdout, '');
      assert.equal(errorOf(run.stderr).code, 'usage', args.join(' '));
      assert.equal(run.requests.length, 0);
    }
  });

  it('rejects an --input that is not a JSON object', async () => {
    const run = await uvd(['call', 'emporium_superficies', '--input', '[1,2]']);
    assert.equal(run.code, 2);
    assert.match(String(errorOf(run.stderr).message), /JSON object/);
  });
});

describe('output without a terminal', () => {
  it('is one line of JSON even without --json', async () => {
    const run = await uvd(['tools']);
    assert.equal(run.code, 0, run.stderr);
    assert.equal(run.stdout.split('\n').length, 2, 'one line plus the newline');
    assert.ok(Array.isArray(JSON.parse(run.stdout)));
  });
});

describe('User-Agent', () => {
  it('goes on every request uvd makes', async () => {
    const run = await uvd(['call', '402milly_get_grid_metadata', '--no-cache']);
    assert.equal(run.code, 0, run.stderr);
    assert.ok(run.requests.length >= 4);
    for (const r of run.requests) assert.equal(r.userAgent, USER_AGENT, `${r.httpMethod} ${r.path} ${r.rpcMethod}`);
  });
});

describe('uvd search', () => {
  it('returns the tools of the stack for "wallet", tagged, with Emporium fields as they came', async () => {
    const run = await uvd(['search', 'wallet', '--json']);
    assert.equal(run.code, 0, run.stderr);
    const items = JSON.parse(run.stdout) as Json[];
    assert.ok(items.length > 0);
    const tools = items.filter((i) => i.tipo === 'tool');
    assert.equal(tools.length, 7);
    const check = tools.find((t) => t.tool === 'describe_check_wallet');
    assert.equal(check?.en_el_mostrador, 'describe-net_describe_check_wallet');
    assert.equal(tools.find((t) => t.tool === 'describe_lookup_wallet')?.por_que_no, 'cobra_por_llamada');
    assert.equal(items.filter((i) => i.tipo === 'combo').length, 3);
    assert.deepEqual(
      toolCalls(run.requests).map((r) => r.tool),
      ['emporium_buscar_tool', 'emporium_buscar_servicio'],
    );
  });

  it('keeps what Emporium says besides the results as one JSON line on stderr', async () => {
    const run = await uvd(['search', 'reputacion', '--json']);
    assert.equal(run.code, 0);
    const items = JSON.parse(run.stdout) as Json[];
    assert.equal(items.filter((i) => i.tipo === 'servicio').length, 0);
    assert.equal(items.filter((i) => i.tipo === 'tool').length, 2);
    assert.equal(run.stderr.split('\n').length, 2, 'one line plus the newline');
    const { aviso } = JSON.parse(run.stderr) as { aviso: Record<string, Json> };
    assert.deepEqual(aviso.emporium_buscar_servicio?.hueco, {
      por_que_no_hay: 'CATALOG_COVERAGE_UNKNOWN',
      prospecto: '',
      que_se_pidio: '',
    });
    assert.deepEqual(aviso.emporium_buscar_tool?.no_listables, ['execution-market', 'meshrelay']);
  });
});

describe('uvd tools', () => {
  it("lists Emporium's own tools", async () => {
    const run = await uvd(['tools']);
    assert.equal(run.code, 0, run.stderr);
    const names = (JSON.parse(run.stdout) as Json[]).map((t) => t.name);
    for (const n of ['emporium_superficies', 'emporium_buscar_tool', 'emporium_buscar_servicio']) {
      assert.ok(names.includes(n), n);
    }
  });

  it('resolves a service through emporium_superficies, even one uvd has never heard of', async () => {
    const run = await uvd(['tools', 'uvd-fixture-surface']);
    assert.equal(run.code, 0, run.stderr);
    assert.deepEqual(
      (JSON.parse(run.stdout) as Json[]).map((t) => t.name),
      ['fixture_status', 'fixture_write'],
    );
    assert.deepEqual(
      toolCalls(run.requests).map((r) => r.tool),
      ['emporium_superficies'],
    );
    assert.ok(run.requests.some((r) => r.path === '/surfaces/uvd-fixture-surface/mcp' && r.rpcMethod === 'tools/list'));
  });

  it('says which services exist when the name is unknown (exit 4)', async () => {
    const run = await uvd(['tools', 'no-such-service']);
    assert.equal(run.code, 4);
    const error = errorOf(run.stderr);
    assert.equal(error.code, 'unknown_service');
    assert.ok((error.details as { known: string[] }).known.includes('describe-net'));
  });

  it('refuses a service that needs a credential, without contacting it (exit 5)', async () => {
    const run = await uvd(['tools', 'execution-market']);
    assert.equal(run.code, 5);
    assert.equal(errorOf(run.stderr).code, 'credential_required');
    assert.ok(!run.requests.some((r) => r.path.startsWith('/surfaces/')));
  });
});

describe('uvd call', () => {
  it('calls a house tool through the counter and prints its structured output', async () => {
    const run = await uvd(['call', 'emporium_superficies', '--input', '{}']);
    assert.equal(run.code, 0, run.stderr);
    const out = JSON.parse(run.stdout) as Json;
    assert.ok(Array.isArray(out.superficies));
    const calls = toolCalls(run.requests, 'emporium_superficies');
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.path, '/mostrador/mcp');
  });

  it('calls a forwarded tool the catalog classifies as lectura, with the input as given', async () => {
    const run = await uvd(['call', '402milly_get_grid_metadata', '--input', '-'], { stdin: '{"tile":3}' });
    assert.equal(run.code, 0, run.stderr);
    assert.deepEqual(JSON.parse(run.stdout), { synthetic: true });
    const lookup = toolCalls(run.requests, 'emporium_buscar_tool');
    assert.deepEqual(lookup[0]?.arguments, { texto: 'get_grid_metadata', limite: 50 });
    const calls = toolCalls(run.requests, '402milly_get_grid_metadata');
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]?.arguments, { tile: 3 });
  });

  it('refuses a tool the catalog marks as paid even when the counter lists it read-only, before calling', async () => {
    const run = await uvd(['call', 'describe-net_describe_lookup_wallet', '--input', '{"wallet":"0x0"}']);
    assert.equal(run.code, 5);
    const error = errorOf(run.stderr);
    assert.equal(error.code, 'refused');
    assert.match(String(error.message), /later version/);
    assert.deepEqual(error.details, {
      tool: 'describe-net_describe_lookup_wallet',
      class: 'cobra_por_llamada',
      source: 'catalog',
      url_mcp: 'https://api.describe.net/mcp',
    });
    assert.equal(toolCalls(run.requests, 'describe-net_describe_lookup_wallet').length, 0);
  });

  it('refuses by the MCP annotations when the catalog does not classify the tool', async () => {
    for (const [name, toolClass] of [
      ['emporium_fixture_writer', 'escribe'],
      ['emporium_fixture_paid', 'cobra_por_llamada'],
    ]) {
      const run = await uvd(['call', name as string]);
      assert.equal(run.code, 5, name);
      const error = errorOf(run.stderr);
      assert.equal((error.details as Json).class, toolClass);
      assert.equal((error.details as Json).source, 'annotations');
      assert.equal(toolCalls(run.requests, name).length, 0);
    }
  });

  it('explains, from the catalog, why a paid tool is not on the counter', async () => {
    // The counter as recorded: it does not publish describe_lookup_wallet at all.
    const recorded = await startFixtureServer({
      derived: ['mcp.call.emporium_buscar_tool.describe_lookup_wallet.json'],
    });
    try {
      const run = await runCli(['call', 'describe-net_describe_lookup_wallet'], {
        UVD_EMPORIUM_URL: recorded.url,
        UVD_CACHE_DIR: tempCacheDir(),
      });
      assert.equal(run.code, 5);
      const error = errorOf(run.stderr);
      assert.equal((error.details as Json).class, 'cobra_por_llamada');
      assert.deepEqual(
        toolCalls(recorded.requests).map((r) => [r.tool, r.arguments]),
        [
          ['emporium_superficies', {}],
          ['emporium_buscar_tool', { texto: 'describe_lookup_wallet', limite: 50 }],
        ],
      );
    } finally {
      await recorded.close();
    }
  });

  it('answers not found (exit 4) for a tool nobody knows', async () => {
    const run = await uvd(['call', 'no_such_tool']);
    assert.equal(run.code, 4);
    assert.equal(errorOf(run.stderr).code, 'unknown_tool');
    assert.equal(toolCalls(run.requests, 'no_such_tool').length, 0);
  });
});

describe('network errors', () => {
  it('exit 3 with a JSON error when Emporium cannot be reached', async () => {
    const run = await runCli(['tools', '--no-cache'], {
      UVD_EMPORIUM_URL: 'http://127.0.0.1:9',
      UVD_CACHE_DIR: tempCacheDir(),
    });
    assert.equal(run.code, 3);
    assert.equal(errorOf(run.stderr).code, 'unreachable');
  });
});

describe('tools/list cache', () => {
  const listCount = (requests: FixtureServer['requests']) =>
    requests.filter((r) => r.rpcMethod === 'tools/list' && r.path === '/mcp').length;

  it('serves a second run from the cache, and --no-cache skips it', async () => {
    const cache = tempCacheDir();
    const first = await uvd(['tools'], { cache });
    assert.equal(listCount(first.requests), 1);
    const second = await uvd(['tools'], { cache });
    assert.equal(second.code, 0);
    assert.equal(second.stdout, first.stdout);
    assert.equal(second.requests.length, 0);
    const third = await uvd(['tools', '--no-cache'], { cache });
    assert.equal(listCount(third.requests), 1);
  });

  it('refetches once the entry is older than the TTL', async () => {
    const cache = tempCacheDir();
    await uvd(['tools'], { cache });
    const [file] = readdirSync(cache).filter((f) => f.endsWith('.json'));
    const path = join(cache, file as string);
    const entry = JSON.parse(readFileSync(path, 'utf8')) as Json;
    entry.fetchedAt = Date.now() - 11 * 60 * 1000;
    writeFileSync(path, JSON.stringify(entry));
    const run = await uvd(['tools'], { cache });
    assert.equal(listCount(run.requests), 1);
  });

  it('honours UVD_CACHE_TTL', async () => {
    const cache = tempCacheDir();
    await uvd(['tools'], { cache });
    const run = await uvd(['tools'], { cache, env: { UVD_CACHE_TTL: '0' } });
    assert.equal(listCount(run.requests), 1);
  });

  it('stores only public tool listings', async () => {
    const cache = tempCacheDir();
    await uvd(['tools'], { cache });
    await uvd(['tools', 'uvd-fixture-surface'], { cache });
    await uvd(['call', 'emporium_superficies', '--input', '{"secret":"do-not-store"}'], { cache });
    const stored = readdirSync(cache).map((f) => readFileSync(join(cache, f), 'utf8'));
    assert.equal(stored.length, 2);
    for (const text of stored) {
      assert.ok(!text.includes('do-not-store'));
      assert.ok(Array.isArray((JSON.parse(text) as Json).value));
    }
  });
});

describe('uvd call fails closed', () => {
  /** Runs `uvd call <name>` and checks it was refused with `toolClass`, before any call of it. */
  async function refusedBeforeCalling(name: string, toolClass: string, source: string) {
    const run = await uvd(['call', name, '--input', '{}']);
    assert.equal(run.code, 5, `${name}: ${run.stderr}`);
    const error = errorOf(run.stderr);
    assert.equal(error.code, 'refused', name);
    assert.equal((error.details as Json).class, toolClass, name);
    assert.equal((error.details as Json).source, source, name);
    assert.equal(toolCalls(run.requests, name).length, 0, name);
    return run;
  }

  it('refuses a catalog entry without por_que_no, on a tool without annotations', async () => {
    await refusedBeforeCalling('402milly_uvd_fixture_unclassified', 'sin_clasificar', 'catalog');
  });

  it('refuses a catalog entry with por_que_no null and en_el_mostrador null', async () => {
    await refusedBeforeCalling('402milly_uvd_fixture_nullnull', 'sin_clasificar', 'catalog');
  });

  it('lets annotations that object win over a catalog "free"', async () => {
    await refusedBeforeCalling('402milly_uvd_fixture_destructive', 'escribe', 'annotations');
    await refusedBeforeCalling('402milly_uvd_fixture_writes', 'escribe', 'annotations');
    await refusedBeforeCalling('402milly_uvd_fixture_payment', 'cobra_por_llamada', 'annotations');
  });

  it('refuses a read-only tool of a surface that needs a credential, without asking the catalog', async () => {
    const run = await refusedBeforeCalling('execution-market_uvd_fixture_tasks', 'pide_credencial', 'surface');
    assert.equal(toolCalls(run.requests, 'emporium_buscar_tool').length, 0);
  });

  it('refuses a tool whose surface is not in the catalog', async () => {
    await refusedBeforeCalling('uvd-ghost-surface_uvd_fixture_tool', 'pide_credencial', 'surface');
  });

  it('refuses a name the counter lists twice', async () => {
    const duplicated = await startFixtureServer({
      extraCounterTools: [
        {
          name: 'emporium_superficies',
          inputSchema: { type: 'object', properties: {} },
          annotations: { readOnlyHint: true, destructiveHint: false },
        },
      ],
    });
    try {
      const run = await runCli(['call', 'emporium_superficies'], {
        UVD_EMPORIUM_URL: duplicated.url,
        UVD_CACHE_DIR: tempCacheDir(),
      });
      assert.equal(run.code, 5, run.stderr);
      assert.equal(errorOf(run.stderr).code, 'refused');
      assert.equal(toolCalls(duplicated.requests, 'emporium_superficies').length, 0);
    } finally {
      await duplicated.close();
    }
  });

  it('decides on a fresh tools/list of the counter, never on the cache', async () => {
    const mutable = structuredClone(counterTools.mutable as Json);
    const changing = await startFixtureServer({
      extraCounterTools: [mutable],
      counterResults: { emporium_fixture_mutable: counterTools.mutableResult as Json },
    });
    try {
      const cache = tempCacheDir();
      const env = { UVD_EMPORIUM_URL: changing.url, UVD_CACHE_DIR: cache };
      const first = await runCli(['call', 'emporium_fixture_mutable'], env);
      assert.equal(first.code, 0, first.stderr);
      (mutable.annotations as Json).readOnlyHint = false;
      const from = changing.requests.length;
      const second = await runCli(['call', 'emporium_fixture_mutable'], env);
      assert.equal(second.code, 5, second.stderr);
      assert.equal(toolCalls(changing.requests.slice(from), 'emporium_fixture_mutable').length, 0);
    } finally {
      await changing.close();
    }
  });
});

describe('uvd tools on a surface that needs a credential', () => {
  for (const service of ['meshrelay', 'uvd-fixture-noauth']) {
    it(`refuses ${service} (exit 5) without contacting it`, async () => {
      const run = await uvd(['tools', service]);
      assert.equal(run.code, 5, run.stderr);
      assert.equal(errorOf(run.stderr).code, 'credential_required');
      assert.ok(!run.requests.some((r) => r.path.startsWith('/surfaces/')));
    });
  }
});

describe('hardening', () => {
  it('refetches when the cache file is corrupt instead of failing', async () => {
    const cache = tempCacheDir();
    await uvd(['tools'], { cache });
    for (const file of readdirSync(cache)) writeFileSync(join(cache, file), 'null');
    const run = await uvd(['tools'], { cache });
    assert.equal(run.code, 0, run.stderr);
    assert.ok(Array.isArray(JSON.parse(run.stdout)));
    assert.equal(run.requests.filter((r) => r.rpcMethod === 'tools/list').length, 1);
  });

  it('never prints the password of a UVD_EMPORIUM_URL it refuses', async () => {
    const run = await runCli(['tools'], {
      UVD_EMPORIUM_URL: 'https://agent:hunter2@emporium.example',
      UVD_CACHE_DIR: tempCacheDir(),
    });
    assert.equal(run.code, 2);
    assert.ok(!run.stderr.includes('hunter2'), run.stderr);
  });
});
