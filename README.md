# uvd

The Ultravioleta DAO command line. Version 0.1 searches
[Emporium](https://emporium.ultravioletadao.xyz), lists MCP tools and calls free, read-only tools
through Emporium's counter. No wallet, no keys: paid, writing and authenticated calls come later.

```sh
npx @ultravioletadao/uvd search wallet               # tools of the stack and third-party services
npx @ultravioletadao/uvd tools                       # Emporium's own MCP tools
npx @ultravioletadao/uvd tools describe-net          # the tools of one service in Emporium's catalog
npx @ultravioletadao/uvd call emporium_superficies   # call a free read-only tool through the counter
```

`npm i -g @ultravioletadao/uvd` installs it; the command is `uvd` either way. On npm the package
is scoped because the registry refused the bare name `uvd` as too close to existing packages.

The same CLI is on PyPI as `uvd`: `uvx uvd …` (it brings its own Node.js through
`nodejs-wheel-binaries`; the first run downloads about 60 MB).

Output is a table on a terminal and JSON otherwise (or with `--json`). Agents: read
[AGENTS.md](AGENTS.md) for the JSON contract and the exit codes.

## Development

Node.js 24. `npm ci`, then:

| Command | What it does |
| --- | --- |
| `npm run typecheck` / `npm run lint` | TypeScript and Biome |
| `npm test` | The suite, offline, against a local server that serves recorded fixtures |
| `npm run build` | Bundles `dist/uvd.mjs` with esbuild |
| `npm pack` | `ultravioletadao-uvd-0.1.0.tgz` |
| `npm run build:wheel` | The PyPI wheel in `dist/` (needs [uv](https://docs.astral.sh/uv/)) |
| `npm run check:artifacts` | Checks the tarball and the wheel carry the third-party licenses |
| `npm run fixtures:serve` | Serves the recorded fixtures locally, for trying uvd offline |

Fixtures are recorded from Emporium by `scripts/record-fixtures.ts`, by hand and rarely; see
[test/fixtures/README.md](test/fixtures/README.md). Releases are published by the manual
`publish` workflow only; nothing publishes on push or merge.

## License

MIT © 2026 Ultravioleta DAO. The bundle includes third-party packages; their licenses ship next
to it as `THIRD_PARTY_LICENSES.txt` (in the npm package and in the wheel).
