#!/usr/bin/env bash

# Managed by Backlog. Reinstall through:
#   backlog hooks install

set -euo pipefail

BACKLOG_BIN="__BACKLOG_BIN__"
BACKLOG_WORKSPACE="__BACKLOG_WORKSPACE__"
PAUSE_FILE="__BACKLOG_PAUSE_FILE__"
REPO_ROOT="$(git rev-parse --show-toplevel)"

# Tell the CLI exactly which project this hook belongs to — covers both
# in_repo (.backlog/ subdir) and user_level (~/.backlog/<name>/) layouts
# without depending on the upward .backlog/ walk.
export BACKLOG_PROJECT_DIR="$BACKLOG_WORKSPACE"

# Escape hatch 1: explicit per-commit opt-out.
if [[ "${BACKLOG_SKIP_HOOK:-}" == "1" ]]; then
  echo "backlog: pre-commit hook skipped (BACKLOG_SKIP_HOOK=1)" >&2
  exit 0
fi

# Escape hatch 2: project-wide pause set with `backlog hooks pause`.
if [[ -f "$PAUSE_FILE" ]]; then
  PAUSED_UNTIL="$(cat "$PAUSE_FILE" 2>/dev/null | head -1 | tr -d '[:space:]')"
  NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if [[ -n "$PAUSED_UNTIL" && "$NOW" < "$PAUSED_UNTIL" ]]; then
    echo "backlog: pre-commit hook paused until $PAUSED_UNTIL" >&2
    echo "backlog: run 'backlog hooks resume' to re-enable now" >&2
    exit 0
  fi
  # Pause expired (or empty file) — clean it up and continue normally.
  rm -f "$PAUSE_FILE"
fi

if [[ ! -x "$BACKLOG_BIN" ]]; then
  echo "backlog: missing local shim at $BACKLOG_BIN" >&2
  echo "Run backlog init or backlog hooks install again." >&2
  exit 1
fi

if ! "$BACKLOG_BIN" claim check --repo-root "$REPO_ROOT" --staged --auto; then
  cat >&2 <<'EOF'

To proceed without a claim:
  - Just this commit:   BACKLOG_SKIP_HOOK=1 git commit ...
  - For 30 minutes:     backlog hooks pause
  - Permanently here:   backlog hooks uninstall

Or set claims.auto_claim_on_commit = true in config.toml so the hook
mints an ad-hoc claim from your staged paths instead of blocking.
EOF
  exit 1
fi
