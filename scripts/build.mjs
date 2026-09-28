// Bundles the CLI into one self-contained ES module, dist/uvd.mjs, with a node shebang.
import { chmod, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { build } from 'esbuild';

const root = join(import.meta.dirname, '..');
const outfile = join(root, 'dist', 'uvd.mjs');
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));

await build({
  entryPoints: [join(root, 'src', 'cli.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  minify: false,
  legalComments: 'eof',
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
console.error(`built ${outfile} (uvd ${version})`);
