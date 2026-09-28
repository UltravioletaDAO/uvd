import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';
import { emporiumBaseUrl } from '../src/config.ts';
import { UvdError } from '../src/errors.ts';
import { userAgentFetch } from '../src/mcp.ts';

const base = (value: string) => emporiumBaseUrl({ UVD_EMPORIUM_URL: value });

describe('UVD_EMPORIUM_URL', () => {
  it('defaults to production and accepts https, and http only on loopback', () => {
    assert.equal(emporiumBaseUrl({}), 'https://emporium.ultravioletadao.xyz');
    assert.equal(base('https://emporium.example/base/'), 'https://emporium.example/base');
    assert.equal(base('http://127.0.0.1:47100'), 'http://127.0.0.1:47100');
    assert.equal(base('http://localhost:8080/'), 'http://localhost:8080');
    assert.equal(base('http://[::1]:9'), 'http://[::1]:9');
  });

  it('refuses user-info, a query or a fragment, without repeating the value', () => {
    for (const value of [
      'https://user:hunter2@emporium.example',
      'https://hunter2@emporium.example',
      'https://emporium.example/?token=hunter2',
      'https://emporium.example/#hunter2',
      'https://emporium.example/?',
      'not a url hunter2',
    ]) {
      assert.throws(
        () => base(value),
        (error: unknown) => error instanceof UvdError && error.exitCode === 2 && !error.message.includes('hunter2'),
        value,
      );
    }
  });

  it('refuses plain http off loopback and other schemes', () => {
    for (const value of [
      'http://emporium.example',
      'http://10.0.0.1',
      'ftp://emporium.example',
      'file:///etc/passwd',
    ]) {
      assert.throws(() => base(value), UvdError, value);
    }
  });
});

describe('userAgentFetch', () => {
  it('does not follow redirects', async () => {
    const hits: string[] = [];
    const server = createServer((req, res) => {
      hits.push(req.url ?? '');
      if (req.url === '/start') res.writeHead(307, { location: '/elsewhere' }).end();
      else res.writeHead(200).end('followed');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const port = (server.address() as AddressInfo).port;
      await assert.rejects(userAgentFetch(`http://127.0.0.1:${port}/start`, { method: 'POST' }));
      assert.deepEqual(hits, ['/start']);
    } finally {
      server.close();
    }
  });
});
