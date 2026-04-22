import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { findWorkspace } from "@cockpit-ai/config";
import { getRunEvents, listActiveRuns, loadRun } from "@cockpit-ai/core";

export function registerRunCommand(program: Command): void {
  const runs = program.command("runs").description("Inspect execution runs");

  runs
    .command("list")
    .description("List active runs")
    .option("--json", "Emit machine-readable JSON")
    .action((options: { json?: boolean }) => {
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .cockpit workspace found. Run `cockpit init` first.");
      }
      const runs = listActiveRuns(workspace.cockpitDir);
      if (options.json) {
        console.log(JSON.stringify(runs, null, 2));
        return;
      }
      if (runs.length === 0) {
        console.log("No active runs.");
        return;
      }
      for (const run of runs) {
        console.log(`${run.id} | ${run.task_id} | ${run.repo} | ${run.agent_id} | ${run.status}`);
      }
    });

  runs
    .command("show")
    .description("Show one run with recent events")
    .argument("<run-id>", "Run id")
    .option("--json", "Emit machine-readable JSON")
    .action((runId: string, options: { json?: boolean }) => {
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .cockpit workspace found. Run `cockpit init` first.");
      }
      const run = loadRun(workspace.cockpitDir, runId);
      if (!run) {
        throw new Error(`Unknown run: ${runId}`);
      }
      if (options.json) {
        console.log(JSON.stringify(run, null, 2));
        return;
      }
      console.log(`Run: ${run.id}`);
      console.log(`Task: ${run.task_id}`);
      console.log(`Repo: ${run.repo}`);
      console.log(`Agent: ${run.agent_id}`);
      console.log(`Status: ${run.status}`);
      console.log(`Branch: ${run.branch}`);
      console.log(`Worktree: ${run.worktree_path}`);
      const events = getRunEvents(workspace.cockpitDir, run.id);
      if (events.length > 0) {
        console.log("Recent events:");
        for (const event of events.slice(-5)) {
          console.log(`- ${event}`);
        }
      }
    });
}
