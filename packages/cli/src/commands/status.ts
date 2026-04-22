import { Command } from "commander";
import { findWorkspace, loadConfig } from "@cockpit-ai/config";
import { buildWorkspaceStatus } from "@cockpit-ai/core";

export function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .description("Show a compact Cockpit workspace summary")
    .option("--json", "Emit machine-readable JSON")
    .action((options: { json?: boolean }) => {
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .cockpit workspace found. Run `cockpit init` first.");
      }

      const config = loadConfig(workspace.cockpitDir);
      const status = buildWorkspaceStatus(workspace.root, workspace.cockpitDir, config);

      if (options.json) {
        console.log(JSON.stringify(status, null, 2));
        return;
      }

      console.log(`Workspace: ${status.workspaceName}`);
      console.log(`Repos: ${status.repoCount}`);
      console.log(`Active claims: ${status.activeClaims}`);
      console.log(`Work items: ${status.workItemCount}`);
      if (Object.keys(status.taskCounts).length === 0) {
        console.log("Tasks: none yet");
        return;
      }
      console.log("Tasks:");
      for (const [taskStatus, count] of Object.entries(status.taskCounts).sort()) {
        console.log(`- ${taskStatus}: ${count}`);
      }
    });
}
