import { Command } from "commander";
import { findProject, loadConfig } from "@backlog/config";
import { garbageCollectWorktrees, listKnownWorktrees } from "@backlog/core";

export function registerWorktreeCommand(program: Command): void {
  const worktree = program.command("worktree").description("Manage Backlog worktrees");

  worktree
    .command("list")
    .description("List worktrees known through run records")
    .option("--repo <repo>", "Only show worktrees for one repo")
    .option("--status <status>", "Only show worktrees for one run status")
    .option("--missing", "Only show worktrees whose path no longer exists")
    .option("--json", "Emit machine-readable JSON")
    .action((options: { repo?: string; status?: string; missing?: boolean; json?: boolean }) => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }
      const worktrees = listKnownWorktrees(workspace.backlogDir).filter((entry) => {
        if (options.repo && entry.repo !== options.repo) {
          return false;
        }
        if (options.status && entry.status !== options.status) {
          return false;
        }
        if (options.missing && entry.exists) {
          return false;
        }
        return true;
      });
      if (options.json) {
        console.log(JSON.stringify(worktrees, null, 2));
        return;
      }
      if (worktrees.length === 0) {
        console.log("No worktrees matched.");
        return;
      }
      for (const entry of worktrees) {
        console.log(`${entry.runId} | ${entry.repo} | ${entry.status} | exists=${entry.exists} | ${entry.path}`);
      }
    });

  worktree
    .command("gc")
    .description("Remove worktrees for terminal runs")
    .option("--dry-run", "Show which worktrees would be removed without deleting them")
    .option("--json", "Emit machine-readable JSON")
    .action(async (options: { json?: boolean; dryRun?: boolean }) => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }
      const config = loadConfig(workspace.backlogDir);
      const result = await garbageCollectWorktrees(workspace.backlogDir, config, {
        ...(options.dryRun ? { dryRun: true } : {}),
      });
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      console.log(`${options.dryRun ? "Would remove" : "Removed"} worktrees: ${result.removed.length}`);
      for (const entry of result.removed) {
        console.log(`- ${entry}`);
      }
      if (result.skipped.length > 0) {
        console.log(`Skipped worktrees: ${result.skipped.length}`);
        for (const entry of result.skipped) {
          console.log(`- ${entry}`);
        }
      }
    });
}
