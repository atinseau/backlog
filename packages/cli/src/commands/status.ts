import { Command } from "commander";
import { findWorkspace, loadConfig } from "@cockpit-ai/config";
import { buildExecutionPlan, buildWorkspaceStatus } from "@cockpit-ai/core";
import { listTasks } from "@cockpit-ai/core";

export function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .description("Show a compact Cockpit workspace summary")
    .option("--repo <id>", "Focus status on one configured repo")
    .option("--json", "Emit machine-readable JSON")
    .action((options: { repo?: string; json?: boolean }) => {
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .cockpit workspace found. Run `cockpit init` first.");
      }

      const config = loadConfig(workspace.cockpitDir);
      if (options.repo && !config.repos.some((repo) => repo.id === options.repo)) {
        throw new Error(`Unknown repo: ${options.repo}`);
      }
      const status = buildWorkspaceStatus(workspace.root, workspace.cockpitDir, config, {
        ...(options.repo ? { repoId: options.repo } : {}),
      });
      const tasksById = new Map(listTasks(workspace.cockpitDir).map((task) => [task.id, task]));
      const fullPlan = buildExecutionPlan(workspace.cockpitDir, config);
      const plan = options.repo
        ? {
            ...fullPlan,
            runnable: fullPlan.runnable.filter((decision) => tasksById.get(decision.taskId)?.repo === options.repo),
            waiting: fullPlan.waiting.filter((decision) => tasksById.get(decision.taskId)?.repo === options.repo),
            blocked: fullPlan.blocked.filter((decision) => tasksById.get(decision.taskId)?.repo === options.repo),
            skipped: fullPlan.skipped.filter((decision) => tasksById.get(decision.taskId)?.repo === options.repo),
          }
        : fullPlan;

      if (options.json) {
        console.log(JSON.stringify({ ...status, plan }, null, 2));
        return;
      }

      console.log(`Workspace: ${status.workspaceName}`);
      if (status.selectedRepoId) {
        console.log(`Repo focus: ${status.selectedRepoId}`);
      }
      console.log(`Repos: ${status.enabledRepoCount} enabled / ${status.repoCount} configured`);
      console.log(`Active claims: ${status.activeClaims}`);
      console.log(`Active runs: ${status.activeRuns}`);
      console.log(`Work items: ${status.workItemCount}`);
      console.log(`Pending sync conflicts: ${status.pendingSyncConflicts}`);
      if (status.repoSummaries.length > 0 && (status.repoCount > 1 || status.selectedRepoId)) {
        console.log("Repo detail:");
        for (const repo of status.repoSummaries) {
          console.log(`- ${repo.id}: enabled=${repo.enabled} work_items=${repo.workItemCount} tasks=${repo.taskCount} active_runs=${repo.activeRuns} active_claims=${repo.activeClaims}`);
        }
      }
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
      if (status.nextActions.length > 0) {
        console.log("");
        console.log("Top next actions:");
        for (const action of status.nextActions) {
          const agentText = action.assignedAgentId ? ` with ${action.assignedAgentId}` : "";
          console.log(`- Start ${action.taskId}${agentText} (${action.reasons.join(", ")})`);
        }
      }
      if (status.hotConflicts.length > 0) {
        console.log("");
        console.log("Hot conflicts:");
        for (const conflict of status.hotConflicts) {
          console.log(`- ${conflict}`);
        }
      }
    });
}
