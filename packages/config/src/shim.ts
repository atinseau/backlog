import fs from "node:fs";
import path from "node:path";

function renderShim(workspaceRoot: string): string {
  return `#!/usr/bin/env bash
set -euo pipefail

WORKSPACE_ROOT="${workspaceRoot}"
DIST_BIN="$WORKSPACE_ROOT/packages/cli/dist/bin.js"
SRC_BIN="$WORKSPACE_ROOT/packages/cli/src/bin.ts"

if [[ -f "$DIST_BIN" ]]; then
  exec node "$DIST_BIN" "$@"
fi

exec pnpm --dir "$WORKSPACE_ROOT" exec tsx "$SRC_BIN" "$@"
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
