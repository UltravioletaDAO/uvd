// Bundles the CLI into one self-contained ES module, dist/uvd.mjs, with a node shebang, and writes
// dist/THIRD_PARTY_LICENSES.txt: the license of every package that ended up inside the bundle
// (read from esbuild's metafile, so the list is always the real one). dist/third-party.json lists
// the same packages for scripts/check-artifacts.mjs; it is not shipped.
import { chmod, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { build } from 'esbuild';

const root = join(import.meta.dirname, '..');
const outfile = join(root, 'dist', 'uvd.mjs');
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));

const result = await build({
  absWorkingDir: root,
  entryPoints: [join(root, 'src', 'cli.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  minify: false,
  legalComments: 'eof',
  metafile: true,
  banner: {
    // The shebang, and a `require` for the CommonJS dependencies bundled into an ES module.
    js: "#!/usr/bin/env node\nimport { createRequire as __uvdCreateRequire } from 'node:module';\nconst require = __uvdCreateRequire(import.meta.url);",
  },
  logLevel: 'warning',
  plugins: [
    {
      // src/version.ts imports package.json for its version: bundle that field and nothing else.
      name: 'package-json-version-only',
      setup(b) {
        const own = join(root, 'package.json');
        b.onLoad({ filter: /package\.json$/ }, (args) =>
          args.path === own ? { contents: JSON.stringify({ version }), loader: 'json' } : undefined,
        );
      },
    },
  ],
});
await chmod(outfile, 0o755);

/** The package directories (`node_modules/<name>` or `node_modules/@scope/<name>`) in the bundle. */
function bundledPackageDirs(metafile) {
  const dirs = new Set();
  for (const input of Object.keys(metafile.inputs)) {
    const at = input.lastIndexOf('node_modules/');
    if (at < 0) continue;
    const segments = input.slice(at + 'node_modules/'.length).split('/');
    const name = segments[0]?.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0];
    dirs.add(`${input.slice(0, at)}node_modules/${name}`);
  }
  return [...dirs];
}

const packages = [];
for (const dir of bundledPackageDirs(result.metafile)) {
  const manifest = JSON.parse(await readFile(join(root, dir, 'package.json'), 'utf8'));
  const licenseFile = (await readdir(join(root, dir))).find((f) => /^(licen[cs]e|copying)/i.test(f));
  if (!licenseFile) throw new Error(`${manifest.name} is bundled but ships no license file`);
  const text = (await readFile(join(root, dir, licenseFile), 'utf8')).trim();
  packages.push({ name: manifest.name, version: manifest.version, license: manifest.license ?? 'see text', text });
}
packages.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));

const rule = '='.repeat(80);
const notice = [
  `uvd ${version} bundles the following third-party packages into uvd.mjs. Their licenses follow.`,
  '',
  ...packages.map((p) => `- ${p.name} ${p.version} (${p.license})`),
  ...packages.flatMap((p) => ['', rule, `${p.name} ${p.version} (${p.license})`, rule, '', p.text]),
  '',
].join('\n');
await writeFile(join(root, 'dist', 'THIRD_PARTY_LICENSES.txt'), notice);
await writeFile(
  join(root, 'dist', 'third-party.json'),
  `${JSON.stringify(
    packages.map(({ name, version: v, license }) => ({ name, version: v, license })),
    null,
    2,
  )}\n`,
);
console.error(`built ${outfile} (uvd ${version}, ${packages.length} bundled packages)`);
