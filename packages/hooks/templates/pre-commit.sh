#!/usr/bin/env bash

# Managed by Backlog. Reinstall through:
#   backlog hooks install

set -euo pipefail

BACKLOG_BIN="__BACKLOG_BIN__"
BACKLOG_WORKSPACE="__BACKLOG_WORKSPACE__"
REPO_ROOT="$(git rev-parse --show-toplevel)"

if [[ ! -x "$BACKLOG_BIN" ]]; then
  echo "backlog: missing local shim at $BACKLOG_BIN" >&2
  echo "Run backlog init or backlog hooks install again." >&2
  exit 1
fi

# Run from the project dir so `claim check` can locate .backlog/ even when
# the staged repo is a sibling of the project (e.g. twoody-app committing
# against a project at twoody-backlog/.backlog/).
cd "$BACKLOG_WORKSPACE"
"$BACKLOG_BIN" claim check --repo-root "$REPO_ROOT" --staged
