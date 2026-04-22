import fs from "node:fs";
import path from "node:path";

export const MANAGED_HOOK_MARKER = "Managed by Cockpit";

function readTemplate(): string {
  return fs.readFileSync(new URL("../templates/pre-commit.sh", import.meta.url), "utf8");
}

export function installPreCommitHook(params: {
  gitDir: string;
  cockpitBin: string;
  force?: boolean;
}): string {
  const hookPath = path.join(params.gitDir, "hooks", "pre-commit");
  const existing = fs.existsSync(hookPath) ? fs.readFileSync(hookPath, "utf8") : "";
  if (existing && !existing.includes(MANAGED_HOOK_MARKER) && !params.force) {
    throw new Error(
      `Existing pre-commit hook is not Cockpit-managed at ${hookPath}. Re-run with --force to replace it.`,
    );
  }

  const rendered = readTemplate().replace("__COCKPIT_BIN__", params.cockpitBin);
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
