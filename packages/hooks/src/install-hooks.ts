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
  upToDate: boolean;
}

// Inline template — keeps the bundled CLI tarball self-contained, no
// templates/ directory shipped. Mirrors templates/pre-commit.sh.
//
// __BACKLOG_WORKSPACE__ is the dir we hand back to the CLI via
// BACKLOG_PROJECT_DIR. For in_repo projects it's the project root (which
// contains .backlog/); for user_level projects it's the project data dir
// itself (config.toml lives there directly). __BACKLOG_PAUSE_FILE__ is the
// resolved absolute path to the pause sentinel — different shape for the
// two layouts.
const PRE_COMMIT_TEMPLATE = `#!/usr/bin/env bash

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
if [[ "\${BACKLOG_SKIP_HOOK:-}" == "1" ]]; then
  echo "backlog: pre-commit hook skipped (BACKLOG_SKIP_HOOK=1)" >&2
  exit 0
fi

# Escape hatch 2: project-wide pause set with \`backlog hooks pause\`.
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
  cat >&2 <<EOF

Backlog pre-commit hook: Backlog is unavailable, so this commit is allowed.
The local Backlog shim is missing:
  $BACKLOG_BIN

Backlog did not block this commit. To remove this hook from the repository:
  backlog hooks uninstall
EOF
  exit 0
fi

HOOK_OUTPUT="$(mktemp "\${TMPDIR:-/tmp}/backlog-pre-commit.XXXXXX")"
if "$BACKLOG_BIN" claim check --repo-root "$REPO_ROOT" --staged --auto >"$HOOK_OUTPUT" 2>&1; then
  if [[ -s "$HOOK_OUTPUT" ]]; then
    cat "$HOOK_OUTPUT" >&2
  fi
  rm -f "$HOOK_OUTPUT"
  exit 0
fi

HOOK_STATUS=$?
HOOK_TEXT="$(cat "$HOOK_OUTPUT" 2>/dev/null || true)"
rm -f "$HOOK_OUTPUT"

if [[ "$HOOK_STATUS" -eq 126 || "$HOOK_STATUS" -eq 127 ]] || printf '%s\n' "$HOOK_TEXT" | grep -E '(env: node: No such file or directory|node: command not found|backlog: no usable binary found|No \\.backlog project found|has no config\\.toml|ENOENT)' >/dev/null 2>&1; then
  cat >&2 <<EOF

Backlog pre-commit hook: Backlog is unavailable, so this commit is allowed.
Backlog could not validate claims from this Git hook environment.

Original Backlog error:
$HOOK_TEXT

Backlog did not block this commit. To remove this hook from the repository:
  backlog hooks uninstall
EOF
  exit 0
fi

if [[ -n "$HOOK_TEXT" ]]; then
  printf '%s\n' "$HOOK_TEXT" >&2
fi

  cat >&2 <<'EOF'

Backlog pre-commit hook blocked this commit.

One or more staged files are protected by an active Backlog run/claim.
To bypass Backlog deliberately:
  - Just this commit:    BACKLOG_SKIP_HOOK=1 git commit ...
  - For 30 minutes:      backlog hooks pause --minutes 30
  - Until re-enabled:    backlog hooks disable
  - Remove this hook:    backlog hooks uninstall

Or set claims.auto_claim_on_commit = true in config.toml so the hook
mints an ad-hoc claim from your staged paths instead of blocking.
EOF
exit 1
`;

function readTemplate(): string {
  return PRE_COMMIT_TEMPLATE;
}

function renderPreCommitHook(params: {
  backlogBin: string;
  projectRoot: string;
  backlogDir?: string;
}): string {
  const backlogDir = params.backlogDir ?? path.join(params.projectRoot, ".backlog");
  const pauseFile = path.join(backlogDir, PAUSE_FILE_NAME);
  return readTemplate()
    .replace("__BACKLOG_BIN__", params.backlogBin)
    .replace("__BACKLOG_WORKSPACE__", params.projectRoot)
    .replace("__BACKLOG_PAUSE_FILE__", pauseFile);
}

export function inspectPreCommitHook(
  gitDir: string,
  backlogBin?: string,
  expected?: { projectRoot: string; backlogDir?: string },
): PreCommitHookStatus {
  const hookPath = path.join(gitDir, "hooks", "pre-commit");
  if (!fs.existsSync(hookPath)) {
    return {
      hookPath,
      exists: false,
      managed: false,
      pointsToBacklogBin: false,
      upToDate: false,
    };
  }

  const contents = fs.readFileSync(hookPath, "utf8");
  const managed = contents.includes(MANAGED_HOOK_MARKER);
  const backlogBinMatch = contents.match(/BACKLOG_BIN="([^"]+)"/);
  const configuredBin = backlogBinMatch?.[1];
  const pointsToBacklogBin = backlogBin ? configuredBin === backlogBin : Boolean(configuredBin);
  const upToDate = Boolean(
    managed &&
    backlogBin &&
    expected &&
    contents === renderPreCommitHook({
      backlogBin,
      projectRoot: expected.projectRoot,
      ...(expected.backlogDir ? { backlogDir: expected.backlogDir } : {}),
    }),
  );

  return {
    hookPath,
    exists: true,
    managed,
    ...(configuredBin ? { backlogBin: configuredBin } : {}),
    pointsToBacklogBin,
    upToDate,
  };
}

export function installPreCommitHook(params: {
  gitDir: string;
  backlogBin: string;
  // For in_repo: the project root containing .backlog/.
  // For user_level: the project data dir itself (~/.backlog/<name>/).
  // Either way: the value we'd hand to BACKLOG_PROJECT_DIR.
  projectRoot: string;
  // Where the project data actually lives. For in_repo this is
  // <projectRoot>/.backlog/; for user_level it equals projectRoot.
  // Defaults to <projectRoot>/.backlog/ to keep older callers working.
  backlogDir?: string;
  force?: boolean;
}): string {
  const hookPath = path.join(params.gitDir, "hooks", "pre-commit");
  const existing = fs.existsSync(hookPath) ? fs.readFileSync(hookPath, "utf8") : "";
  if (existing && !existing.includes(MANAGED_HOOK_MARKER) && !params.force) {
    throw new Error(
      `Existing pre-commit hook is not Backlog-managed at ${hookPath}. Re-run with --force to replace it.`,
    );
  }

  const rendered = renderPreCommitHook({
    backlogBin: params.backlogBin,
    projectRoot: params.projectRoot,
    ...(params.backlogDir ? { backlogDir: params.backlogDir } : {}),
  });
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
