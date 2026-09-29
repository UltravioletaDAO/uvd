// Checks what the release artifacts carry: the npm tarball and the PyPI wheel must both ship
// THIRD_PARTY_LICENSES.txt, and it must name every package esbuild put into the bundle
// (dist/third-party.json, written by scripts/build.mjs). Run after `npm pack` and the wheel build.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const { name, version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const bundled = JSON.parse(readFileSync(join(root, 'dist', 'third-party.json'), 'utf8'));
// `npm pack` names a scoped package's tarball without the `@` and with `-` for the `/`:
// @ultravioletadao/uvd 0.1.0 is ultravioletadao-uvd-0.1.0.tgz. The wheel keeps the PyPI name, uvd.
const tgzName = `${name.replace(/^@/, '').replace('/', '-')}-${version}.tgz`;
const tgz = join(root, tgzName);
const wheel = join(root, 'dist', `uvd-${version}-py3-none-any.whl`);

const read = (command, args) => execFileSync(command, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
const notices = {
  [tgzName]: () => read('tar', ['-xzOf', tgz, 'package/dist/THIRD_PARTY_LICENSES.txt']),
  [`uvd-${version}-py3-none-any.whl`]: () => read('unzip', ['-p', wheel, 'uvd/_bundle/THIRD_PARTY_LICENSES.txt']),
};

let failed = false;
if (bundled.length === 0) {
  console.error('dist/third-party.json lists no bundled package');
  failed = true;
}
for (const [artifact, extract] of Object.entries(notices)) {
  let text = '';
  try {
    text = extract();
  } catch {
    console.error(`${artifact}: THIRD_PARTY_LICENSES.txt is missing`);
    failed = true;
    continue;
  }
  const missing = bundled.filter((p) => !text.includes(`- ${p.name} ${p.version} (`));
  if (missing.length > 0) {
    console.error(`${artifact}: THIRD_PARTY_LICENSES.txt does not name ${missing.map((p) => p.name).join(', ')}`);
    failed = true;
  } else {
    console.log(`${artifact}: THIRD_PARTY_LICENSES.txt names all ${bundled.length} bundled packages`);
  }
}
console.log(bundled.map((p) => `  ${p.name} ${p.version} (${p.license})`).join('\n'));
process.exit(failed ? 1 : 0);
