import { Command } from "commander";
import { findWorkspace } from "@cockpit-ai/config";
import {
  completeRun,
  createRunHandoff,
  failRun,
  getRunEvents,
  getTask,
  listAllRuns,
  loadRun,
  sendRunToReview,
  updateRunStatus,
  updateTaskStatus,
} from "@cockpit-ai/core";

export function registerRunCommand(program: Command): void {
  const runs = program.command("runs").description("Inspect execution runs");

  runs
    .command("list")
    .description("List known runs")
    .option("--json", "Emit machine-readable JSON")
    .action((options: { json?: boolean }) => {
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .cockpit workspace found. Run `cockpit init` first.");
      }
      const runs = listAllRuns(workspace.cockpitDir);
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

  runs
    .command("interrupt")
    .description("Interrupt an active run and return its task to planned")
    .argument("<run-id>", "Run id")
    .action((runId: string) => {
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .cockpit workspace found. Run `cockpit init` first.");
      }
      const run = loadRun(workspace.cockpitDir, runId);
      if (!run) {
        throw new Error(`Unknown run: ${runId}`);
      }
      if (run.status !== "running" && run.status !== "preparing") {
        throw new Error(`Run ${runId} is not interruptible from status ${run.status}`);
      }
      updateRunStatus(workspace.cockpitDir, runId, "interrupted", "Interrupted by operator");
      updateTaskStatus(workspace.cockpitDir, run.task_id, "planned");
      console.log(`Interrupted ${runId}`);
    });

  runs
    .command("resume")
    .description("Resume an interrupted run")
    .argument("<run-id>", "Run id")
    .action((runId: string) => {
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .cockpit workspace found. Run `cockpit init` first.");
      }
      const run = loadRun(workspace.cockpitDir, runId);
      if (!run) {
        throw new Error(`Unknown run: ${runId}`);
      }
      if (run.status !== "interrupted") {
        throw new Error(`Run ${runId} is not resumable from status ${run.status}`);
      }
      updateRunStatus(workspace.cockpitDir, runId, "running", "Resumed by operator");
      const task = getTask(workspace.cockpitDir, run.task_id);
      if (task) {
        updateTaskStatus(workspace.cockpitDir, task.id, "running");
      }
      console.log(`Resumed ${runId}`);
    });

  runs
    .command("complete")
    .description("Mark a run as complete and archive it")
    .argument("<run-id>", "Run id")
    .option("--summary <text>", "Completion summary")
    .action(async (runId: string, options: { summary?: string }) => {
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .cockpit workspace found. Run `cockpit init` first.");
      }
      await completeRun(workspace.cockpitDir, runId, options.summary);
      console.log(`Completed ${runId}`);
    });

  runs
    .command("fail")
    .description("Mark a run as failed and archive it")
    .argument("<run-id>", "Run id")
    .option("--summary <text>", "Failure summary")
    .action(async (runId: string, options: { summary?: string }) => {
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .cockpit workspace found. Run `cockpit init` first.");
      }
      await failRun(workspace.cockpitDir, runId, options.summary);
      console.log(`Failed ${runId}`);
    });

  runs
    .command("review")
    .description("Mark a run as awaiting review")
    .argument("<run-id>", "Run id")
    .option("--summary <text>", "Review summary")
    .action((runId: string, options: { summary?: string }) => {
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .cockpit workspace found. Run `cockpit init` first.");
      }
      sendRunToReview(workspace.cockpitDir, runId, options.summary);
      console.log(`Sent ${runId} to review`);
    });

  runs
    .command("handoff")
    .description("Write a handoff note for a run")
    .argument("<run-id>", "Run id")
    .requiredOption("--reason <text>", "Why the handoff is needed")
    .action((runId: string, options: { reason: string }) => {
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .cockpit workspace found. Run `cockpit init` first.");
      }
      const handoffPath = createRunHandoff(workspace.cockpitDir, runId, options.reason);
      console.log(`Wrote handoff to ${handoffPath}`);
    });
}
