# Test fixtures

The test suite never goes to the network. `test/helpers/fixture-server.ts` is a local MCP server
that answers with the files here; tests point `UVD_EMPORIUM_URL` at it.

- `emporium/` — exchanges **recorded** from https://emporium.ultravioletadao.xyz by
  `scripts/record-fixtures.ts` (sequential, 1 s apart, uvd's own User-Agent, Emporium only).
  `manifest.json` lists every recording session and its files. Never edited by hand; the recorder
  never overwrites a file.
- `derived/` — exchanges **derived** from a recorded one. Each file names its source (`derivedFrom`)
  and explains why the derivation is exact (`why`). Tests opt in to them one by one.
- `synthetic/` — **hand-written** data, labeled as such in a `note`: a surface uvd's code cannot
  know, and counter entries that exercise the refusal rules. Tests opt in to them.

The fixture server always rewrites the `url_mcp` of every surface in `emporium_superficies` to
`http://127.0.0.1:<port>/surfaces/<id>/mcp`, so following a surface never leaves the machine.
