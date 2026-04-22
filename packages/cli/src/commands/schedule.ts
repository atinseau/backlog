import { Command } from "commander";
import { findWorkspace, loadConfig } from "@cockpit-ai/config";
import { buildExecutionPlan } from "@cockpit-ai/core";

export function registerScheduleCommand(program: Command): void {
  const schedule = program.command("schedule").description("Plan and execute task scheduling");

  schedule
    .command("simulate")
    .description("Explain what Cockpit would run right now")
    .option("--work-item <id>", "Restrict to one work item")
    .option("--task <id>", "Restrict to one task")
    .option("--json", "Emit machine-readable JSON")
    .action((options: { workItem?: string; task?: string; json?: boolean }) => {
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .cockpit workspace found. Run `cockpit init` first.");
      }
      const config = loadConfig(workspace.cockpitDir);
      const plan = buildExecutionPlan(workspace.cockpitDir, config, {
        ...(options.workItem ? { workItemId: options.workItem } : {}),
        ...(options.task ? { taskId: options.task } : {}),
      });

      if (options.json) {
        console.log(JSON.stringify(plan, null, 2));
        return;
      }

      console.log("Simulation");
      console.log("");
      console.log(`Runnable: ${plan.runnable.length}`);
      for (const decision of plan.runnable) {
        console.log(`- ${decision.taskId} score=${decision.score} ${decision.reasons.join(", ")}`);
      }
      console.log("");
      console.log(`Waiting: ${plan.waiting.length}`);
      for (const decision of plan.waiting) {
        console.log(`- ${decision.taskId} ${decision.reasons.join(", ")}`);
      }
      console.log("");
      console.log(`Blocked: ${plan.blocked.length}`);
      for (const decision of plan.blocked) {
        console.log(`- ${decision.taskId} ${decision.reasons.join(", ")}`);
      }
    });
}
