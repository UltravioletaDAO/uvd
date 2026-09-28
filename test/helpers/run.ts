import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const ROOT = join(import.meta.dirname, '..', '..');
/** The CLI under test: the TypeScript source by default, or the bundle with UVD_TEST_BIN. */
export const BIN = join(ROOT, process.env.UVD_TEST_BIN ?? 'src/cli.ts');

export interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

export function tempCacheDir(): string {
  return mkdtempSync(join(tmpdir(), 'uvd-test-cache-'));
}

/** Runs uvd with pipes (so stdout is NOT a terminal), an isolated cache and the given env. */
export function runCli(args: string[], env: Record<string, string>, stdin?: string): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...proxyEnv(), ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(stdin ?? '');
  });
}

/** The proxy variables of the offline run, passed through so the CLI sees them too. */
function proxyEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of [
    'HTTPS_PROXY',
    'HTTP_PROXY',
    'NO_PROXY',
    'https_proxy',
    'http_proxy',
    'no_proxy',
    'NODE_USE_ENV_PROXY',
  ]) {
    const value = process.env[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}
