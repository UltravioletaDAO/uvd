import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * The tools/list cache. One JSON file per endpoint, named by the SHA-256 of its URL. It only ever
 * holds public tool listings: no headers, no arguments, no credentials, and the stored URL has its
 * user-info and query string removed.
 */

const FORMAT = 1;

interface Entry<T> {
  format: number;
  endpoint: string;
  fetchedAt: number;
  value: T;
}

export class ToolsCache {
  readonly dir: string;
  readonly ttlMs: number;
  readonly now: () => number;

  constructor(dir: string, ttlMs: number, now: () => number = Date.now) {
    this.dir = dir;
    this.ttlMs = ttlMs;
    this.now = now;
  }

  fileFor(url: string): string {
    return join(this.dir, `${createHash('sha256').update(url).digest('hex')}.json`);
  }

  /** The cached value if it exists and is younger than the TTL; `undefined` otherwise. */
  async get<T>(url: string): Promise<T | undefined> {
    let entry: Entry<T>;
    try {
      entry = JSON.parse(await readFile(this.fileFor(url), 'utf8')) as Entry<T>;
    } catch {
      return undefined;
    }
    if (entry.format !== FORMAT || typeof entry.fetchedAt !== 'number') return undefined;
    const age = this.now() - entry.fetchedAt;
    if (age < 0 || age >= this.ttlMs) return undefined;
    return entry.value;
  }

  /** Stores a value. A cache that cannot be written is not an error: the next run refetches. */
  async set<T>(url: string, value: T): Promise<void> {
    const entry: Entry<T> = { format: FORMAT, endpoint: publicEndpoint(url), fetchedAt: this.now(), value };
    const file = this.fileFor(url);
    const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      await mkdir(this.dir, { recursive: true, mode: 0o700 });
      await writeFile(tmp, JSON.stringify(entry), { mode: 0o600 });
      await rename(tmp, file);
    } catch {
      // Read-only home, full disk, a race with another uvd: all fine to ignore.
    }
  }
}

/** The URL without user-info, query or fragment: what the cache file may say about its origin. */
export function publicEndpoint(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return '';
  }
}
