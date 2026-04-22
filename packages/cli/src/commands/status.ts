import { Command } from "commander";
import { findWorkspace, loadConfig } from "@cockpit-ai/config";
import { buildExecutionPlan, buildWorkspaceStatus } from "@cockpit-ai/core";

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
      const plan = buildExecutionPlan(workspace.cockpitDir, config);

      if (options.json) {
        console.log(JSON.stringify({ ...status, plan }, null, 2));
        return;
      }

      console.log(`Workspace: ${status.workspaceName}`);
      console.log(`Repos: ${status.repoCount}`);
      console.log(`Active claims: ${status.activeClaims}`);
      console.log(`Active runs: ${status.activeRuns}`);
      console.log(`Work items: ${status.workItemCount}`);
      console.log("Work item states:");
      for (const [workStatus, count] of Object.entries(status.workItemCounts)) {
        if (count > 0) {
          console.log(`- ${workStatus}: ${count}`);
        }
      }
      if (Object.keys(status.taskCounts).length === 0) {
        console.log("Tasks: none yet");
        return;
      }
      console.log("Tasks:");
      for (const [taskStatus, count] of Object.entries(status.taskCounts).sort()) {
        console.log(`- ${taskStatus}: ${count}`);
      }
      console.log("");
      console.log(`Runnable now: ${plan.runnable.length}`);
      console.log(`Waiting now: ${plan.waiting.length}`);
      console.log(`Blocked now: ${plan.blocked.length}`);
      if (plan.runnable.length > 0) {
        console.log("");
        console.log("Top next actions:");
        for (const decision of plan.runnable.slice(0, 3)) {
          console.log(`- Start ${decision.taskId} (${decision.reasons.join(", ")})`);
        }
      }
    });
}
