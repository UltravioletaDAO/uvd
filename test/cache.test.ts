import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { publicEndpoint, ToolsCache } from '../src/cache.ts';
import { cacheDir, cacheTtlMs } from '../src/config.ts';
import { tempCacheDir } from './helpers/run.ts';

const URL_A = 'https://emporium.example/mcp';

describe('ToolsCache', () => {
  it('serves a fresh entry', async () => {
    let now = 1_000_000;
    const cache = new ToolsCache(tempCacheDir(), 600_000, () => now);
    await cache.set(URL_A, [{ name: 'x' }]);
    now += 599_999;
    assert.deepEqual(await cache.get(URL_A), [{ name: 'x' }]);
  });
  it('does not serve an entry once the TTL has passed', async () => {
    let now = 1_000_000;
    const cache = new ToolsCache(tempCacheDir(), 600_000, () => now);
    await cache.set(URL_A, [{ name: 'x' }]);
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
  it('treats a missing or corrupt file as a miss', async () => {
    const cache = new ToolsCache(join(tempCacheDir(), 'nope'), 600_000);
    assert.equal(await cache.get(URL_A), undefined);
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
