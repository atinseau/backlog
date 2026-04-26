import fs from "node:fs";
import path from "node:path";

function renderShim(workspaceRoot: string): string {
  return `#!/usr/bin/env bash
set -euo pipefail

# Local shim invoked by the pre-commit hook. Delegates to the installed
# \`backlog\` binary because git's hook environment doesn't have pnpm (or
# usually anything beyond /usr/bin) on PATH.
#
# Resolution order:
#   1. \`backlog\` on PATH (typical global install)
#   2. ~/.npm-global/bin/backlog (common npm prefix not on PATH)
#   3. $BACKLOG_DEV_DIST (explicit override for working from a dev tree)
#   4. <workspace>/packages/cli/dist/bin.js (only matches when the workspace
#      itself IS the backlog source tree)

if command -v backlog >/dev/null 2>&1; then
  exec backlog "$@"
fi

if [[ -x "$HOME/.npm-global/bin/backlog" ]]; then
  exec "$HOME/.npm-global/bin/backlog" "$@"
fi

if [[ -n "\${BACKLOG_DEV_DIST:-}" && -f "$BACKLOG_DEV_DIST" ]]; then
  exec node "$BACKLOG_DEV_DIST" "$@"
fi

WORKSPACE_DIST="${workspaceRoot}/packages/cli/dist/bin.js"
if [[ -f "$WORKSPACE_DIST" ]]; then
  exec node "$WORKSPACE_DIST" "$@"
fi

cat >&2 <<'EOF'
backlog: no usable binary found.

Install it globally:
  npm install -g backlog

Or, when working from a checkout of the backlog source, export
BACKLOG_DEV_DIST pointing at the built CLI:
  export BACKLOG_DEV_DIST="$HOME/path/to/backlog-cli/packages/cli/dist/bin.js"
EOF
exit 1
`;
}

export function writeLocalShim(backlogDir: string, workspaceRoot: string): string {
  const binDir = path.join(backlogDir, "bin");
  fs.mkdirSync(binDir, { recursive: true });
  const shimPath = path.join(binDir, "backlog");
  fs.writeFileSync(shimPath, renderShim(workspaceRoot), "utf8");
  fs.chmodSync(shimPath, 0o755);
  return shimPath;
}
