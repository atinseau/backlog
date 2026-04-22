import { Command } from "commander";
import { findWorkspace, loadConfig } from "@cockpit-ai/config";
import { garbageCollectWorktrees } from "@cockpit-ai/core";

export function registerWorktreeCommand(program: Command): void {
  const worktree = program.command("worktree").description("Manage Cockpit worktrees");

  worktree
    .command("gc")
    .description("Remove worktrees for terminal runs")
    .option("--json", "Emit machine-readable JSON")
    .action(async (options: { json?: boolean }) => {
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .cockpit workspace found. Run `cockpit init` first.");
      }
      const config = loadConfig(workspace.cockpitDir);
      const result = await garbageCollectWorktrees(workspace.cockpitDir, config);
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      console.log(`Removed worktrees: ${result.removed.length}`);
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
