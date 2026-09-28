import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'node:test';
import pkg from '../package.json' with { type: 'json' };
import { USER_AGENT, VERSION } from '../src/version.ts';
import { ROOT } from './helpers/run.ts';

it('npm and PyPI packages carry the same version', () => {
  const pyproject = readFileSync(join(ROOT, 'python', 'pyproject.toml'), 'utf8');
  assert.equal(/^version = "([^"]+)"$/m.exec(pyproject)?.[1], pkg.version);
  assert.equal(VERSION, pkg.version);
});

it('the wheel pins the Node.js it runs on', () => {
  const pyproject = readFileSync(join(ROOT, 'python', 'pyproject.toml'), 'utf8');
  assert.match(pyproject, /dependencies = \["nodejs-wheel-binaries==24\.19\.0"\]/);
});

it('the User-Agent names uvd, its version and its repository', () => {
  assert.equal(USER_AGENT, `uvd/${pkg.version} (+https://github.com/UltravioletaDAO/uvd)`);
});
