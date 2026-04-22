#!/usr/bin/env bash

# Managed by Cockpit. Reinstall through:
#   cockpit hooks install

set -euo pipefail

COCKPIT_BIN="__COCKPIT_BIN__"
REPO_ROOT="$(git rev-parse --show-toplevel)"

if [[ ! -x "$COCKPIT_BIN" ]]; then
  echo "cockpit: missing local shim at $COCKPIT_BIN" >&2
  echo "Run cockpit init or cockpit hooks install again." >&2
  exit 1
fi

"$COCKPIT_BIN" claim check --repo-root "$REPO_ROOT" --staged
