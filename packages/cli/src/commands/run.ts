import { Command } from "commander";
import { findWorkspace } from "@backlog/config";
import {
  approveRun,
  completeRun,
  createRunHandoff,
  failRun,
  garbageCollectArchivedRuns,
  getRunEvents,
  getRunHandoffPath,
  getTask,
  listAllRuns,
  loadRun,
  requestRunChanges,
  sendRunToReview,
  updateRunStatus,
  updateTaskStatus,
} from "@backlog/core";

export function registerRunCommand(program: Command): void {
  const runs = program.command("runs").description("Inspect execution runs");

  runs
    .command("gc")
    .description("Purge archived run directories")
    .requiredOption("--all", "Confirm that every archived run should be removed")
    .option("--json", "Emit machine-readable JSON")
    .action((options: { all?: boolean; json?: boolean }) => {
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .backlog workspace found. Run `backlog init` first.");
      }
      if (!options.all) {
        throw new Error("runs gc requires --all.");
      }
      const result = garbageCollectArchivedRuns(workspace.backlogDir);
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      console.log(`Removed archived runs: ${result.removed.length}`);
      for (const runId of result.removed) {
        console.log(`- ${runId}`);
      }
    });

  runs
    .command("list")
    .description("List known runs")
    .option("--review", "Only show runs awaiting review")
    .option("--status <status>", "Only show runs in one status")
    .option("--repo <repo>", "Only show runs for one repo")
    .option("--task <id>", "Only show runs for one task")
    .option("--work-item <id>", "Only show runs for one work item")
    .option("--agent <id>", "Only show runs for one agent")
    .option("--json", "Emit machine-readable JSON")
    .action((options: {
      json?: boolean;
      review?: boolean;
      status?: string;
      repo?: string;
      task?: string;
      workItem?: string;
      agent?: string;
    }) => {
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .backlog workspace found. Run `backlog init` first.");
      }
      const runs = listAllRuns(workspace.backlogDir).filter((run) => {
        if (options.review && run.status !== "awaiting_review") {
          return false;
        }
        if (options.status && run.status !== options.status) {
          return false;
        }
        if (options.repo && run.repo !== options.repo) {
          return false;
        }
        if (options.task && run.task_id !== options.task) {
          return false;
        }
        if (options.workItem && run.work_item_id !== options.workItem) {
          return false;
        }
        if (options.agent && run.agent_id !== options.agent) {
          return false;
        }
        return true;
      });
      if (options.json) {
        console.log(JSON.stringify(runs, null, 2));
        return;
      }
      if (runs.length === 0) {
        console.log(options.review ? "No runs awaiting review." : "No active runs.");
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
        throw new Error("No .backlog workspace found. Run `backlog init` first.");
      }
      const run = loadRun(workspace.backlogDir, runId);
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
      if (run.result) {
        console.log(`Result: ${run.result}`);
      }
      const handoffPath = getRunHandoffPath(workspace.backlogDir, run.id);
      if (handoffPath) {
        console.log(`Handoff: ${handoffPath}`);
      }
      if (run.artifacts.length > 0) {
        console.log("Artifacts:");
        for (const artifact of run.artifacts) {
          console.log(`- ${artifact.kind}: ${artifact.value}`);
        }
      }
      const events = getRunEvents(workspace.backlogDir, run.id);
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
        throw new Error("No .backlog workspace found. Run `backlog init` first.");
      }
      const run = loadRun(workspace.backlogDir, runId);
      if (!run) {
        throw new Error(`Unknown run: ${runId}`);
      }
      if (run.status !== "running" && run.status !== "preparing") {
        throw new Error(`Run ${runId} is not interruptible from status ${run.status}`);
      }
      updateRunStatus(workspace.backlogDir, runId, "interrupted", "Interrupted by operator");
      updateTaskStatus(workspace.backlogDir, run.task_id, "planned");
      console.log(`Interrupted ${runId}`);
    });

  runs
    .command("resume")
    .description("Resume an interrupted run")
    .argument("<run-id>", "Run id")
    .action((runId: string) => {
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .backlog workspace found. Run `backlog init` first.");
      }
      const run = loadRun(workspace.backlogDir, runId);
      if (!run) {
        throw new Error(`Unknown run: ${runId}`);
      }
      if (run.status !== "interrupted") {
        throw new Error(`Run ${runId} is not resumable from status ${run.status}`);
      }
      updateRunStatus(workspace.backlogDir, runId, "running", "Resumed by operator");
      const task = getTask(workspace.backlogDir, run.task_id);
      if (task) {
        updateTaskStatus(workspace.backlogDir, task.id, "running");
      }
      console.log(`Resumed ${runId}`);
    });

  runs
    .command("approve")
    .description("Approve a reviewed run and complete its task")
    .argument("<run-id>", "Run id")
    .option("--summary <text>", "Approval summary")
    .action(async (runId: string, options: { summary?: string }) => {
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .backlog workspace found. Run `backlog init` first.");
      }
      await approveRun(workspace.backlogDir, runId, options.summary);
      console.log(`Approved ${runId}`);
    });

  runs
    .command("complete")
    .description("Mark a run as complete and archive it")
    .argument("<run-id>", "Run id")
    .option("--summary <text>", "Completion summary")
    .action(async (runId: string, options: { summary?: string }) => {
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .backlog workspace found. Run `backlog init` first.");
      }
      await completeRun(workspace.backlogDir, runId, options.summary);
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
        throw new Error("No .backlog workspace found. Run `backlog init` first.");
      }
      await failRun(workspace.backlogDir, runId, options.summary);
      console.log(`Failed ${runId}`);
    });

  runs
    .command("review")
    .description("Mark a run as awaiting review")
    .argument("<run-id>", "Run id")
    .option("--summary <text>", "Review summary")
    .action(async (runId: string, options: { summary?: string }) => {
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .backlog workspace found. Run `backlog init` first.");
      }
      await sendRunToReview(workspace.backlogDir, runId, options.summary);
      console.log(`Sent ${runId} to review`);
    });

  runs
    .command("request-changes")
    .description("Reject a reviewed run, archive it, and re-plan the task")
    .argument("<run-id>", "Run id")
    .requiredOption("--reason <text>", "What should change before retrying")
    .action(async (runId: string, options: { reason: string }) => {
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .backlog workspace found. Run `backlog init` first.");
      }
      const handoffPath = await requestRunChanges(workspace.backlogDir, runId, options.reason);
      console.log(`Requested changes for ${runId}`);
      console.log(`Handoff: ${handoffPath}`);
    });

  runs
    .command("handoff")
    .description("Write a handoff note for a run")
    .argument("<run-id>", "Run id")
    .requiredOption("--reason <text>", "Why the handoff is needed")
    .action((runId: string, options: { reason: string }) => {
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .backlog workspace found. Run `backlog init` first.");
      }
      const handoffPath = createRunHandoff(workspace.backlogDir, runId, options.reason);
      console.log(`Wrote handoff to ${handoffPath}`);
    });
}
