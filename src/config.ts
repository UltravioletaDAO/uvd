import { homedir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_EMPORIUM_URL } from './emporium.ts';
import { usage } from './errors.ts';

/** How long a cached tools/list stays fresh unless UVD_CACHE_TTL says otherwise. */
export const DEFAULT_CACHE_TTL_SECONDS = 600;

type Env = Record<string, string | undefined>;

/** Hosts that may be reached over plain http (a local Emporium or the test fixtures). */
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * The Emporium base URL: UVD_EMPORIUM_URL, or production. https only (http only on loopback), and
 * no user-info, query or fragment. Errors never repeat the value: it may hold a password.
 */
export function emporiumBaseUrl(env: Env): string {
  const raw = env.UVD_EMPORIUM_URL?.trim() || DEFAULT_EMPORIUM_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw usage('UVD_EMPORIUM_URL is not a valid URL');
  }
  if (url.username || url.password || url.search || url.hash || raw.includes('?') || raw.includes('#')) {
    throw usage('UVD_EMPORIUM_URL must not carry credentials, a query or a fragment');
  }
  if (url.protocol === 'http:' ? !LOOPBACK.has(url.hostname) : url.protocol !== 'https:') {
    throw usage('UVD_EMPORIUM_URL must be an https URL (http only for 127.0.0.1, localhost or ::1)');
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
}

/**
 * The per-user cache directory: UVD_CACHE_DIR if set; otherwise ~/Library/Caches/uvd on macOS,
 * %LOCALAPPDATA%\uvd\Cache on Windows and $XDG_CACHE_HOME/uvd (default ~/.cache/uvd) elsewhere.
 */
export function cacheDir(env: Env, platform: NodeJS.Platform = process.platform, home: string = homedir()): string {
  if (env.UVD_CACHE_DIR) return env.UVD_CACHE_DIR;
  if (platform === 'darwin') return join(home, 'Library', 'Caches', 'uvd');
  if (platform === 'win32') return join(env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'uvd', 'Cache');
  const xdg = env.XDG_CACHE_HOME;
  // The XDG spec says a relative path must be ignored.
  return join(xdg?.startsWith('/') ? xdg : join(home, '.cache'), 'uvd');
}

/** The cache TTL in milliseconds: UVD_CACHE_TTL (seconds, a non-negative integer) or 10 minutes. */
export function cacheTtlMs(env: Env): number {
  const raw = env.UVD_CACHE_TTL;
  if (raw === undefined || raw === '') return DEFAULT_CACHE_TTL_SECONDS * 1000;
  if (!/^\d+$/.test(raw)) throw usage(`UVD_CACHE_TTL must be a whole number of seconds: ${raw}`);
  return Number(raw) * 1000;
}
