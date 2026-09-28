import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { publicEndpoint, ToolsCache } from '../src/cache.ts';
import { cacheDir, cacheTtlMs } from '../src/config.ts';
import type { Tool } from '../src/mcp.ts';
import { tempCacheDir } from './helpers/run.ts';

const URL_A = 'https://emporium.example/mcp';
const TOOLS: Tool[] = [{ name: 'x', inputSchema: { type: 'object' } }];

describe('ToolsCache', () => {
  it('serves a fresh entry', async () => {
    let now = 1_000_000;
    const cache = new ToolsCache(tempCacheDir(), 600_000, () => now);
    await cache.set(URL_A, TOOLS);
    now += 599_999;
    assert.deepEqual(await cache.get(URL_A), TOOLS);
  });
  it('does not serve an entry once the TTL has passed', async () => {
    let now = 1_000_000;
    const cache = new ToolsCache(tempCacheDir(), 600_000, () => now);
    await cache.set(URL_A, TOOLS);
    now += 600_000;
    assert.equal(await cache.get(URL_A), undefined);
  });
  it('keeps one file per endpoint, without user-info or query in it', async () => {
    const dir = tempCacheDir();
    const cache = new ToolsCache(dir, 600_000);
    await cache.set('https://user:secret@emporium.example/mcp?token=abc', []);
    const files = readdirSync(dir);
    assert.equal(files.length, 1);
    const text = readFileSync(join(dir, files[0] as string), 'utf8');
    assert.ok(!text.includes('secret') && !text.includes('token'), text);
    assert.equal(JSON.parse(text).endpoint, 'https://emporium.example/mcp');
  });
  it('treats a missing file as a miss', async () => {
    const cache = new ToolsCache(join(tempCacheDir(), 'nope'), 600_000);
    assert.equal(await cache.get(URL_A), undefined);
  });

  it('treats a corrupt or wrongly shaped file as a miss, never as a value or an error', async () => {
    const dir = tempCacheDir();
    mkdirSync(dir, { recursive: true });
    const cache = new ToolsCache(dir, 600_000);
    const fresh = Date.now();
    const bodies = [
      'not json',
      'null',
      '[]',
      '"str"',
      '{}',
      JSON.stringify({ format: 1, fetchedAt: fresh, value: {} }),
      JSON.stringify({ format: 1, fetchedAt: fresh, value: 'str' }),
      JSON.stringify({ format: 1, fetchedAt: fresh, value: [1, 2] }),
      JSON.stringify({ format: 1, fetchedAt: fresh, value: [null] }),
      JSON.stringify({ format: 1, fetchedAt: fresh, value: [{ title: 'no name' }] }),
      JSON.stringify({ format: 1, fetchedAt: String(fresh), value: TOOLS }),
      JSON.stringify({ format: 2, fetchedAt: fresh, value: TOOLS }),
    ];
    for (const body of bodies) {
      writeFileSync(cache.fileFor(URL_A), body);
      assert.equal(await cache.get(URL_A), undefined, body);
    }
    writeFileSync(cache.fileFor(URL_A), JSON.stringify({ format: 1, fetchedAt: fresh, value: TOOLS }));
    assert.deepEqual(await cache.get(URL_A), TOOLS);
  });
  it('strips user-info, query and fragment from the stored endpoint', () => {
    assert.equal(publicEndpoint('http://a:b@h:1/p?q=1#f'), 'http://h:1/p');
  });
});

describe('cache location and TTL', () => {
  it('follows each platform convention', () => {
    assert.equal(cacheDir({}, 'darwin', '/Users/u'), '/Users/u/Library/Caches/uvd');
    assert.equal(cacheDir({}, 'linux', '/home/u'), '/home/u/.cache/uvd');
    assert.equal(cacheDir({ XDG_CACHE_HOME: '/xdg' }, 'linux', '/home/u'), '/xdg/uvd');
    assert.equal(cacheDir({ XDG_CACHE_HOME: 'relative' }, 'linux', '/home/u'), '/home/u/.cache/uvd');
    assert.equal(cacheDir({ UVD_CACHE_DIR: '/c' }, 'linux', '/home/u'), '/c');
  });
  it('defaults to 10 minutes and takes UVD_CACHE_TTL in seconds', () => {
    assert.equal(cacheTtlMs({}), 600_000);
    assert.equal(cacheTtlMs({ UVD_CACHE_TTL: '5' }), 5_000);
    assert.throws(() => cacheTtlMs({ UVD_CACHE_TTL: '-1' }));
  });
});
