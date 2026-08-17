import fs from "node:fs";
import path from "node:path";

function renderShim(projectRoot: string): string {
  return `#!/usr/bin/env bash
set -euo pipefail

# Local shim invoked by the pre-commit hook. Git's hook environment carries a
# minimal PATH, so we resolve the \`backlog\` executable ourselves.
#
# Resolution order:
#   1. $BACKLOG_DEV_BIN (explicit override for working from a dev tree)
#   2. <workspace>/dist/backlog (only matches when the workspace itself IS the
#      backlog source tree and has been built)
#   3. \`backlog\` on PATH (typical install)
#   4. ~/.local/bin/backlog (where install.sh puts it when PATH lacks it)

if [[ -n "\${BACKLOG_DEV_BIN:-}" && -x "$BACKLOG_DEV_BIN" ]]; then
  exec "$BACKLOG_DEV_BIN" "$@"
fi

WORKSPACE_BIN="${projectRoot}/dist/backlog"
if [[ -x "$WORKSPACE_BIN" ]]; then
  exec "$WORKSPACE_BIN" "$@"
fi

if command -v backlog >/dev/null 2>&1; then
  exec backlog "$@"
fi

if [[ -x "$HOME/.local/bin/backlog" ]]; then
  exec "$HOME/.local/bin/backlog" "$@"
fi

cat >&2 <<'EOF'
backlog: no usable binary found.

Install it:
  curl -fsSL https://raw.githubusercontent.com/atinseau/backlog/main/install.sh | bash

Or, when working from a checkout of the backlog source, build it and export
BACKLOG_DEV_BIN pointing at the binary:
  bun run build
  export BACKLOG_DEV_BIN="$HOME/path/to/backlog/dist/backlog"
EOF
exit 1
`;
}

/**
 * Does this directory look like a built checkout of the backlog source? The
 * shim prefers it so that hacking on backlog exercises the local build rather
 * than whichever release happens to be installed.
 */
function looksLikeBacklogSourceRoot(candidate: string): boolean {
  const packagePath = path.join(candidate, "package.json");
  const binPath = path.join(candidate, "dist", "backlog");
  if (!fs.existsSync(packagePath) || !fs.existsSync(binPath)) {
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
