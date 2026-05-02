import fs from "node:fs";
import path from "node:path";

function renderShim(projectRoot: string): string {
  return `#!/usr/bin/env bash
set -euo pipefail

# Local shim invoked by the pre-commit hook. Delegates to the installed
# \`backlog\` binary because git's hook environment doesn't have pnpm (or
# usually anything beyond /usr/bin) on PATH.
#
# Resolution order:
#   1. $BACKLOG_DEV_DIST (explicit override for working from a dev tree)
#   2. <workspace>/packages/cli/dist/bin.js (only matches when the workspace
#      itself IS the backlog source tree)
#   3. \`backlog\` on PATH (typical global install)
#   4. ~/.npm-global/bin/backlog (common npm prefix not on PATH)

if [[ -n "\${BACKLOG_DEV_DIST:-}" && -f "$BACKLOG_DEV_DIST" ]]; then
  exec node "$BACKLOG_DEV_DIST" "$@"
fi

WORKSPACE_DIST="${projectRoot}/packages/cli/dist/bin.js"
WORKSPACE_CLI_PKG="${projectRoot}/packages/cli/package.json"
if [[ -f "$WORKSPACE_DIST" && -f "$WORKSPACE_CLI_PKG" ]] && node -e 'const fs=require("fs"); const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.exit(p.name === "backlog" ? 0 : 1)' "$WORKSPACE_CLI_PKG" >/dev/null 2>&1; then
  exec node "$WORKSPACE_DIST" "$@"
fi

if command -v backlog >/dev/null 2>&1; then
  exec backlog "$@"
fi

if [[ -x "$HOME/.npm-global/bin/backlog" ]]; then
  exec "$HOME/.npm-global/bin/backlog" "$@"
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

function looksLikeBacklogSourceRoot(candidate: string): boolean {
  const packagePath = path.join(candidate, "packages", "cli", "package.json");
  const distPath = path.join(candidate, "packages", "cli", "dist", "bin.js");
  if (!fs.existsSync(packagePath) || !fs.existsSync(distPath)) {
    return false;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(packagePath, "utf8")) as { name?: unknown };
    return parsed.name === "backlog";
  } catch {
    return false;
  }
}

export function pickLocalShimProjectRoot(projectRoot: string, repoRoots: string[] = []): string {
  for (const repoRoot of repoRoots) {
    const resolved = path.resolve(repoRoot);
    if (looksLikeBacklogSourceRoot(resolved)) {
      return resolved;
    }
  }
  return projectRoot;
}

export function writeLocalShim(backlogDir: string, projectRoot: string): string {
  const binDir = path.join(backlogDir, "bin");
  fs.mkdirSync(binDir, { recursive: true });
  const shimPath = path.join(binDir, "backlog");
  fs.writeFileSync(shimPath, renderShim(projectRoot), "utf8");
  fs.chmodSync(shimPath, 0o755);
  return shimPath;
}

export function isLocalShimUpToDate(backlogDir: string, projectRoot: string): boolean {
  const shimPath = path.join(backlogDir, "bin", "backlog");
  if (!fs.existsSync(shimPath)) {
    return false;
  }
  try {
    return fs.readFileSync(shimPath, "utf8") === renderShim(projectRoot);
  } catch {
    return false;
  }
}
