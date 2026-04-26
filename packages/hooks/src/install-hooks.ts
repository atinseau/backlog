import fs from "node:fs";
import path from "node:path";

export const MANAGED_HOOK_MARKER = "Managed by Backlog";

export interface PreCommitHookStatus {
  hookPath: string;
  exists: boolean;
  managed: boolean;
  backlogBin?: string;
  pointsToBacklogBin: boolean;
}

function readTemplate(): string {
  return fs.readFileSync(new URL("../templates/pre-commit.sh", import.meta.url), "utf8");
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
