import { Command, Option } from "commander";
import { findProject } from "@backlog/config";
import {
  aggregateUsage,
  aggregateUsageByBucket,
  approveRun,
  completeRun,
  createRunHandoff,
  estimateRunCost,
  failRun,
  garbageCollectArchivedRuns,
  getRunEvents,
  getRunHandoffPath,
  getSubTask,
  isTerminalRunStatus,
  listAllRuns,
  loadRun,
  requestRunChanges,
  sendRunToReview,
  updateRunStatus,
  updateSubTaskStatus,
} from "@backlog/core";

export function registerRunCommand(program: Command): void {
  const runs = program.command("runs").description("Inspect execution runs");

  runs
    .command("gc")
    .description("Purge archived run directories")
    .requiredOption("--all", "Confirm that every archived run should be removed")
    .option("--json", "Emit machine-readable JSON")
    .action((options: { all?: boolean; json?: boolean }) => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
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
    .option("--active", "Only show active runs")
    .option("--archived", "Only show archived runs")
    .option("--repository <repository>", "Only show runs for one repository")
    .addOption(new Option("--repo <repo>", "Only show runs for one repository").hideHelp())
    .option("--subtask <id>", "Only show runs for one subtask")
    .option("--task <id>", "Only show runs for one parent task")
    .option("--agent <id>", "Only show runs for one agent")
    .option("--json", "Emit machine-readable JSON")
    .action((options: {
      json?: boolean;
      review?: boolean;
      status?: string;
      active?: boolean;
      archived?: boolean;
      repo?: string;
      subtask?: string;
      task?: string;
      agent?: string;
    }) => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }
      if (options.active && options.archived) {
        throw new Error("Use either --active or --archived, not both.");
      }
      const runs = listAllRuns(workspace.backlogDir).filter((run) => {
        const active = !isTerminalRunStatus(run.status);
        if (options.active && !active) {
          return false;
        }
        if (options.archived && active) {
          return false;
        }
        if (options.review && run.status !== "awaiting_review") {
          return false;
        }
        if (options.status && run.status !== options.status) {
          return false;
        }
        if (options.repo && run.repo !== options.repo) {
          return false;
        }
        if (options.subtask && run.subtask_id !== options.subtask) {
          return false;
        }
        if (options.task && run.task_id !== options.task) {
          return false;
        }
        if (options.agent && run.agent_id !== options.agent) {
          return false;
        }
        return true;
      }).sort((a, b) => {
        const aActive = !isTerminalRunStatus(a.status);
        const bActive = !isTerminalRunStatus(b.status);
        if (aActive !== bActive) return aActive ? -1 : 1;
        const aTime = Date.parse(a.finished_at ?? a.started_at ?? "");
        const bTime = Date.parse(b.finished_at ?? b.started_at ?? "");
        return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
      });
      if (options.json) {
        console.log(JSON.stringify(runs, null, 2));
        return;
      }
      if (runs.length === 0) {
        console.log(options.review ? "No runs awaiting review." : "No runs.");
        return;
      }
      for (const run of runs) {
        const bucket = isTerminalRunStatus(run.status) ? "archived" : "active";
        console.log(`${run.id} | ${bucket} | ${run.subtask_id} | ${run.repo} | ${run.agent_id} | ${run.status} | ${run.execution_mode} | claims=${run.claim_ids.length}`);
      }
    });

  runs
    .command("show")
    .description("Show one run with recent events")
    .argument("<run-id>", "Run id")
    .option("--json", "Emit machine-readable JSON")
    .action((runId: string, options: { json?: boolean }) => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
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
      console.log(`Task: ${run.subtask_id}`);
      console.log(`Repository: ${run.repo}`);
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
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }
      const run = loadRun(workspace.backlogDir, runId);
      if (!run) {
        throw new Error(`Unknown run: ${runId}`);
      }
      if (run.status !== "running" && run.status !== "preparing") {
        throw new Error(`Run ${runId} is not interruptible from status ${run.status}`);
      }
      updateRunStatus(workspace.backlogDir, runId, "interrupted", "Interrupted by operator");
      updateSubTaskStatus(workspace.backlogDir, run.subtask_id, "planned");
      console.log(`Interrupted ${runId}`);
    });

  runs
    .command("resume")
    .description("Resume an interrupted run")
    .argument("<run-id>", "Run id")
    .action((runId: string) => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }
      const run = loadRun(workspace.backlogDir, runId);
      if (!run) {
        throw new Error(`Unknown run: ${runId}`);
      }
      if (run.status !== "interrupted") {
        throw new Error(`Run ${runId} is not resumable from status ${run.status}`);
      }
      updateRunStatus(workspace.backlogDir, runId, "running", "Resumed by operator");
      const task = getSubTask(workspace.backlogDir, run.subtask_id);
      if (task) {
        updateSubTaskStatus(workspace.backlogDir, task.id, "running");
      }
      console.log(`Resumed ${runId}`);
    });

  runs
    .command("approve")
    .description("Approve a reviewed run and complete its task")
    .argument("<run-id>", "Run id")
    .option("--summary <text>", "Approval summary")
    .action(async (runId: string, options: { summary?: string }) => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
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
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
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
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
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
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
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
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
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
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }
      const handoffPath = createRunHandoff(workspace.backlogDir, runId, options.reason);
      console.log(`Wrote handoff to ${handoffPath}`);
    });

  runs
    .command("estimate")
    .description("Predict the USD cost of a future run by taking the median of past runs that match")
    .option("--repository <id>", "Filter the history to a single repository")
    .addOption(new Option("--repo <id>", "Filter the history to a single repository").hideHelp())
    .option("--agent <id>", "Filter the history to a single agent")
    .option("--since <iso>", "Only consider runs whose usage events are at or after this timestamp")
    .option("--json", "Emit machine-readable JSON")
    .action((options: { repo?: string; agent?: string; since?: string; json?: boolean }) => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }
      const estimate = estimateRunCost(workspace.backlogDir, {
        ...(options.repo ? { repo: options.repo } : {}),
        ...(options.agent ? { agent_id: options.agent } : {}),
        ...(options.since ? { sinceIso: options.since } : {}),
      });

      if (options.json) {
        console.log(JSON.stringify(estimate, null, 2));
        return;
      }
      if (!estimate) {
        console.log("Not enough run history yet (need ≥3 matching past runs).");
        console.log("Run a few tasks first, then come back.");
        return;
      }
      const dollar = `$${estimate.cost_usd.toFixed(4)}`;
      console.log(`Predicted next run cost: ${dollar}`);
      console.log(
        `  median ${estimate.median_input_tokens.toLocaleString()} in / ${estimate.median_output_tokens.toLocaleString()} out across ${estimate.sample_size} runs`,
      );
      console.log("Use --json to surface this in the board UI / orchestrator panel.");
    });

  runs
    .command("cost")
    .description("Aggregate token usage and USD cost across runs from their events.ndjson")
    .option("--run <id>", "Limit the report to one run")
    .option("--since <iso>", "Only count usage events with ts >= this ISO timestamp")
    .option("--bucket <day|week|month>", "Aggregate by time bucket instead of by run")
    .option("--json", "Emit machine-readable JSON")
    .action((options: { run?: string; since?: string; bucket?: string; json?: boolean }) => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }

      // --bucket is a different shape (time-series) and not really
      // composable with --run (one run lives in one bucket), so we
      // branch up front.
      if (options.bucket) {
        if (options.bucket !== "day" && options.bucket !== "week" && options.bucket !== "month") {
          throw new Error(`--bucket must be 'day', 'week', or 'month' (got ${options.bucket}).`);
        }
        const series = aggregateUsageByBucket(workspace.backlogDir, options.bucket, {
          ...(options.since ? { sinceIso: options.since } : {}),
        });
        if (options.json) {
          console.log(JSON.stringify(series, null, 2));
          return;
        }
        if (series.length === 0) {
          console.log("No usage events recorded yet.");
          return;
        }
        const dollar = (n: number) => `$${n.toFixed(4)}`;
        const tokens = (n: number) => n.toLocaleString();
        console.log(`Cost by ${options.bucket}:`);
        for (const point of series) {
          console.log(
            `  ${point.bucket}: ${dollar(point.totals.cost_usd).padEnd(10)} ` +
              `(${tokens(point.totals.input_tokens)} in / ${tokens(point.totals.output_tokens)} out)`,
          );
        }
        return;
      }

      const result = aggregateUsage(workspace.backlogDir, {
        ...(options.run ? { runIds: [options.run] } : {}),
        ...(options.since ? { sinceIso: options.since } : {}),
      });

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      if (result.runs.length === 0) {
        console.log("No usage events recorded yet.");
        console.log("(Executors haven't started forwarding provider usage blocks into events.ndjson.)");
        return;
      }

      const dollar = (n: number) => `$${n.toFixed(4)}`;
      const tokens = (n: number) => n.toLocaleString();

      console.log(`Total cost: ${dollar(result.totals.cost_usd)}`);
      console.log(
        `  input ${tokens(result.totals.input_tokens)} | output ${tokens(result.totals.output_tokens)} | cache_read ${tokens(result.totals.cache_read_input_tokens)} | cache_create ${tokens(result.totals.cache_creation_input_tokens)}`,
      );
      if (result.totals.unknown_model_tokens > 0) {
        console.log(
          `  ${tokens(result.totals.unknown_model_tokens)} tokens spent on models with no pricing entry (cost = $0)`,
        );
      }
      console.log("");
      console.log("By model:");
      for (const [model, modelTotals] of Object.entries(result.perModel) as [
        string,
        typeof result.totals,
      ][]) {
        console.log(
          `  ${model}: ${dollar(modelTotals.cost_usd)} (${tokens(modelTotals.input_tokens)} in / ${tokens(modelTotals.output_tokens)} out)`,
        );
      }
      console.log("");
      console.log("By run:");
      for (const run of result.runs) {
        console.log(`  ${run.runId}: ${dollar(run.totals.cost_usd)}`);
      }
    });
}
