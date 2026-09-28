// Builds the pure PyPI wheel (py3-none-any) from the bundle: copies dist/uvd.mjs, its third-party
// license notice and LICENSE into python/ and runs `uv build --wheel`. The wheel lands in dist/.
// Run `npm run build` first.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const bundle = join(root, 'dist', 'uvd.mjs');
if (!existsSync(bundle)) {
  console.error('dist/uvd.mjs is missing: run `npm run build` first');
  process.exit(1);
}
const npmVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const pyVersion = /^version = "([^"]+)"$/m.exec(readFileSync(join(root, 'python', 'pyproject.toml'), 'utf8'))?.[1];
if (pyVersion !== npmVersion) {
  console.error(`version mismatch: package.json ${npmVersion}, python/pyproject.toml ${pyVersion}`);
  process.exit(1);
}
mkdirSync(join(root, 'python', 'src', 'uvd', '_bundle'), { recursive: true });
copyFileSync(bundle, join(root, 'python', 'src', 'uvd', '_bundle', 'uvd.mjs'));
copyFileSync(
  join(root, 'dist', 'THIRD_PARTY_LICENSES.txt'),
  join(root, 'python', 'src', 'uvd', '_bundle', 'THIRD_PARTY_LICENSES.txt'),
);
copyFileSync(join(root, 'LICENSE'), join(root, 'python', 'LICENSE'));
const run = spawnSync('uv', ['build', '--wheel', '--out-dir', join(root, 'dist'), join(root, 'python')], {
  stdio: 'inherit',
});
process.exit(run.status ?? 1);
