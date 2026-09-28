"""Runs the uvd bundle with the Node.js of nodejs-wheel-binaries.

Arguments, stdin, stdout, stderr and the exit code pass through untouched: on POSIX the launcher
replaces itself with node (exec); on Windows, where exec does not keep the console, it waits for
node and exits with its code.
"""

from __future__ import annotations

import os
import subprocess
import sys

BUNDLE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_bundle", "uvd.mjs")


def node_path() -> str:
    from nodejs_wheel import executable

    if os.name == "nt":
        return os.path.join(executable.ROOT_DIR, "node.exe")
    return os.path.join(executable.ROOT_DIR, "bin", "node")


def main() -> None:
    node = node_path()
    argv = [node, BUNDLE, *sys.argv[1:]]
    if os.name == "nt":
        try:
            sys.exit(subprocess.call(argv))
        except KeyboardInterrupt:
            sys.exit(130)
    os.execv(node, argv)
