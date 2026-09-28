# uvd

The Ultravioleta DAO command line, packaged for Python tools (`pip`, `pipx`, `uvx`). It is the same
CLI as the npm package `uvd`: a single Node.js bundle, run by the Node.js that the
[`nodejs-wheel-binaries`](https://pypi.org/project/nodejs-wheel-binaries/) wheel provides, so no
separate Node.js install is needed.

```sh
uvx uvd --version
uvx uvd search wallet
uvx uvd tools describe-net
uvx uvd call describe-net_describe_check_wallet --input '{"wallet":"0x..."}'
```

The first run downloads the Node.js wheel (about 56-63 MB). Wheels exist for macOS 13+ and Linux
with glibc 2.28+ (and Windows); elsewhere pip falls back to building Node.js from source. The
`basedpyright` package ships the same way.

Documentation: https://github.com/UltravioletaDAO/uvd — for agents, see `AGENTS.md` there.
