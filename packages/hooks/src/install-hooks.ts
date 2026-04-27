import fs from "node:fs";
import path from "node:path";

export const MANAGED_HOOK_MARKER = "Managed by Backlog";
export const PAUSE_FILE_NAME = "hook-paused-until";

export interface PreCommitHookStatus {
  hookPath: string;
  exists: boolean;
  managed: boolean;
  backlogBin?: string;
  pointsToBacklogBin: boolean;
}

// Inline template — keeps the bundled CLI tarball self-contained, no
// templates/ directory shipped. Mirrors templates/pre-commit.sh.
const PRE_COMMIT_TEMPLATE = `#!/usr/bin/env bash

# Managed by Backlog. Reinstall through:
#   backlog hooks install

set -euo pipefail

BACKLOG_BIN="__BACKLOG_BIN__"
BACKLOG_WORKSPACE="__BACKLOG_WORKSPACE__"
PAUSE_FILE="$BACKLOG_WORKSPACE/.backlog/${PAUSE_FILE_NAME}"
REPO_ROOT="$(git rev-parse --show-toplevel)"

# Escape hatch 1: explicit per-commit opt-out.
if [[ "\${BACKLOG_SKIP_HOOK:-}" == "1" ]]; then
  echo "backlog: pre-commit hook skipped (BACKLOG_SKIP_HOOK=1)" >&2
  exit 0
fi

# Escape hatch 2: workspace-wide pause set with \`backlog hooks pause\`.
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

# Run from the workspace dir so \`claim check\` can locate .backlog/ even when
# the staged repo is a sibling of the workspace (e.g. twoody-app committing
# against a workspace at twoody-backlog/.backlog/).
cd "$BACKLOG_WORKSPACE"
if ! "$BACKLOG_BIN" claim check --repo-root "$REPO_ROOT" --staged; then
  cat >&2 <<'EOF'

To proceed without a claim:
  - Just this commit:   BACKLOG_SKIP_HOOK=1 git commit ...
  - For 30 minutes:     backlog hooks pause
  - Permanently here:   backlog hooks uninstall
EOF
  exit 1
fi
`;

function readTemplate(): string {
  return PRE_COMMIT_TEMPLATE;
}

export function inspectPreCommitHook(gitDir: string, backlogBin?: string): PreCommitHookStatus {
  const hookPath = path.join(gitDir, "hooks", "pre-commit");
  if (!fs.existsSync(hookPath)) {
    return {
      hookPath,
      exists: false,
      managed: false,
      pointsToBacklogBin: false,
    };
  }

  const contents = fs.readFileSync(hookPath, "utf8");
  const managed = contents.includes(MANAGED_HOOK_MARKER);
  const backlogBinMatch = contents.match(/BACKLOG_BIN="([^"]+)"/);
  const configuredBin = backlogBinMatch?.[1];

  return {
    hookPath,
    exists: true,
    managed,
    ...(configuredBin ? { backlogBin: configuredBin } : {}),
    pointsToBacklogBin: backlogBin ? configuredBin === backlogBin : Boolean(configuredBin),
  };
}

export function installPreCommitHook(params: {
  gitDir: string;
  backlogBin: string;
  workspaceRoot: string;
  force?: boolean;
}): string {
  const hookPath = path.join(params.gitDir, "hooks", "pre-commit");
  const existing = fs.existsSync(hookPath) ? fs.readFileSync(hookPath, "utf8") : "";
  if (existing && !existing.includes(MANAGED_HOOK_MARKER) && !params.force) {
    throw new Error(
      `Existing pre-commit hook is not Backlog-managed at ${hookPath}. Re-run with --force to replace it.`,
    );
  }

  const rendered = readTemplate()
    .replace("__BACKLOG_BIN__", params.backlogBin)
    .replace("__BACKLOG_WORKSPACE__", params.workspaceRoot);
  fs.mkdirSync(path.dirname(hookPath), { recursive: true });
  fs.writeFileSync(hookPath, rendered, "utf8");
  fs.chmodSync(hookPath, 0o755);
  return hookPath;
}

export function uninstallPreCommitHook(gitDir: string): boolean {
  const hookPath = path.join(gitDir, "hooks", "pre-commit");
  if (!fs.existsSync(hookPath)) {
    return false;
  }

  const existing = fs.readFileSync(hookPath, "utf8");
  if (!existing.includes(MANAGED_HOOK_MARKER)) {
    throw new Error(`Refusing to remove unmanaged pre-commit hook at ${hookPath}.`);
  }

  fs.unlinkSync(hookPath);
  return true;
}

// Used by `backlog hooks pause` and the hook itself — kept here so the
// template + CLI agree on the path.
export function pauseFilePath(backlogDir: string): string {
  return path.join(backlogDir, PAUSE_FILE_NAME);
}

export function writePauseUntil(backlogDir: string, untilIso: string): string {
  const pausePath = pauseFilePath(backlogDir);
  fs.writeFileSync(pausePath, `${untilIso}\n`, "utf8");
  return pausePath;
}

export function clearPause(backlogDir: string): boolean {
  const pausePath = pauseFilePath(backlogDir);
  if (!fs.existsSync(pausePath)) return false;
  fs.unlinkSync(pausePath);
  return true;
}

export function readPauseUntil(backlogDir: string): string | null {
  const pausePath = pauseFilePath(backlogDir);
  if (!fs.existsSync(pausePath)) return null;
  return fs.readFileSync(pausePath, "utf8").trim();
}
