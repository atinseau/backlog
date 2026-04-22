import path from "node:path";
import { Command } from "commander";
import { findWorkspace } from "@cockpit-ai/config";
import { detectGitDir, detectRepoRoot } from "@cockpit-ai/git";
import { inspectPreCommitHook, installPreCommitHook, uninstallPreCommitHook } from "@cockpit-ai/hooks";

export function registerHooksCommand(program: Command): void {
  const hooks = program.command("hooks").description("Manage Cockpit Git hooks");

  hooks
    .command("status")
    .description("Inspect the pre-commit hook in the current repo")
    .option("--repo-root <path>", "Target repo root. Defaults to current git repo")
    .option("--json", "Emit machine-readable JSON")
    .action(async (options: { repoRoot?: string; json?: boolean }) => {
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .cockpit workspace found. Run `cockpit init` first.");
      }
      const repoRoot = options.repoRoot ?? await detectRepoRoot();
      const gitDir = await detectGitDir(repoRoot);
      const cockpitBin = path.join(workspace.cockpitDir, "bin", "cockpit");
      const status = inspectPreCommitHook(gitDir, cockpitBin);

      if (options.json) {
        console.log(JSON.stringify(status, null, 2));
        return;
      }

      console.log(`Hook: ${status.hookPath}`);
      console.log(`Exists: ${status.exists}`);
      console.log(`Managed: ${status.managed}`);
      if (status.cockpitBin) {
        console.log(`Cockpit bin: ${status.cockpitBin}`);
      }
      console.log(`Points to local shim: ${status.pointsToCockpitBin}`);
    });

  hooks
    .command("install")
    .description("Install the managed pre-commit hook in the current repo")
    .option("--repo-root <path>", "Target repo root. Defaults to current git repo")
    .option("--force", "Replace an existing non-Cockpit hook")
    .action(async (options: { repoRoot?: string; force?: boolean }) => {
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .cockpit workspace found. Run `cockpit init` first.");
      }
      const repoRoot = options.repoRoot ?? await detectRepoRoot();
      const gitDir = await detectGitDir(repoRoot);
      const hookPath = installPreCommitHook({
        gitDir,
        cockpitBin: path.join(workspace.cockpitDir, "bin", "cockpit"),
        ...(options.force ? { force: true } : {}),
      });
      console.log(`Installed pre-commit hook at ${hookPath}`);
    });

  hooks
    .command("uninstall")
    .description("Remove the managed pre-commit hook from the current repo")
    .option("--repo-root <path>", "Target repo root. Defaults to current git repo")
    .action(async (options: { repoRoot?: string }) => {
      const repoRoot = options.repoRoot ?? await detectRepoRoot();
      const gitDir = await detectGitDir(repoRoot);
      const removed = uninstallPreCommitHook(gitDir);
      console.log(removed ? "Removed managed pre-commit hook." : "No managed pre-commit hook found.");
    });
}
