import { type Run, type SubTask } from "@backlog/schemas";
import { listActiveRuns, listArchivedRuns } from "./run-store.js";
import { listSubTasks } from "./state-files.js";
import { runSubTaskId } from "./execution-target.js";

// Default estimates when we have no historical data. Calibrated to
// match the kind of work that actually lands here: small HTML / config
// edits typically run in 1-3 minutes; medium-risk refactors in 5-10;
// high-risk migrations in 20-30. The previous flat 30-min fallback
// over-estimated everything by an order of magnitude and made the
// "il reste …" pill useless. Once a project has 3+ archived runs
// the median takes over per-repo.
const FALLBACK_LOW_RISK_SECONDS = 2 * 60;
const FALLBACK_MEDIUM_RISK_SECONDS = 5 * 60;
const FALLBACK_HIGH_RISK_SECONDS = 20 * 60;
export const FALLBACK_TASK_DURATION_SECONDS = FALLBACK_MEDIUM_RISK_SECONDS;

function fallbackForRisk(risk: SubTask["risk"]): number {
  if (risk === "low") return FALLBACK_LOW_RISK_SECONDS;
  if (risk === "high") return FALLBACK_HIGH_RISK_SECONDS;
  return FALLBACK_MEDIUM_RISK_SECONDS;
}

export interface TaskEstimate {
  seconds: number;
  source: "manual" | "auto";
  sample_size?: number;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

function runDurationSeconds(run: Run): number | null {
  if (!run.started_at || !run.finished_at) return null;
  // Count both succeeded and awaiting_review runs — the executor has
  // finished its work in both cases, the difference is whether a
  // human has approved. Treating awaiting_review as "done" lets us
  // start improving estimates as soon as the agent finishes a task,
  // not only after the user clicks ✓.
  if (run.status !== "succeeded" && run.status !== "awaiting_review") return null;
  const startedMs = Date.parse(run.started_at);
  const finishedMs = Date.parse(run.finished_at);
  if (!Number.isFinite(startedMs) || !Number.isFinite(finishedMs)) return null;
  const seconds = Math.round((finishedMs - startedMs) / 1000);
  return seconds > 0 ? seconds : null;
}

export interface EstimatorContext {
  archivedRuns?: Run[];
  tasksById?: Map<string, SubTask>;
}

function loadContext(backlogDir: string, ctx?: EstimatorContext): Required<EstimatorContext> {
  // Pull from BOTH archived and active runs. An awaiting_review run
  // sits in active until approved, but its duration is meaningful as
  // soon as the executor finishes — including it in the data set lets
  // the estimator improve immediately on the first successful run
  // instead of waiting for the human to click approve.
  const archivedRuns =
    ctx?.archivedRuns ?? [...listArchivedRuns(backlogDir), ...listActiveRuns(backlogDir)];
  const tasksById = ctx?.tasksById ?? new Map(listSubTasks(backlogDir).map((task) => [task.id, task]));
  return { archivedRuns, tasksById };
}

export function estimateSubTask(
  backlogDir: string,
  task: SubTask,
  ctx?: EstimatorContext,
): TaskEstimate {
  if (task.estimated_duration_seconds && task.estimate_source === "manual") {
    return { seconds: task.estimated_duration_seconds, source: "manual" };
  }

  const { archivedRuns, tasksById } = loadContext(backlogDir, ctx);
  const lane = task.execution.lane;

  const sameLaneSameRepo: number[] = [];
  const sameRepo: number[] = [];

  for (const run of archivedRuns) {
    const duration = runDurationSeconds(run);
    if (duration === null) continue;
    if (run.repo !== task.repo) continue;
    sameRepo.push(duration);
    // Match by subtask_id — `tasksById` is keyed by SubTask.id, while
    // `run.task_id` is the parent task's id, which would never hit.
    const subtaskId = runSubTaskId(run);
    const runTask = subtaskId ? tasksById.get(subtaskId) : undefined;
    if (lane && runTask?.execution.lane === lane) {
      sameLaneSameRepo.push(duration);
    }
  }

  // Lowered the threshold from 3 → 1: even a single run is a much
  // better signal than a generic risk-keyed fallback. The median of
  // one is just that run's duration; subsequent runs converge fast.
  const tightMedian = sameLaneSameRepo.length >= 1 ? median(sameLaneSameRepo) : null;
  const looseMedian = sameRepo.length >= 1 ? median(sameRepo) : null;

  if (tightMedian !== null) {
    return { seconds: Math.round(tightMedian), source: "auto", sample_size: sameLaneSameRepo.length };
  }
  if (looseMedian !== null) {
    return { seconds: Math.round(looseMedian), source: "auto", sample_size: sameRepo.length };
  }

  if (task.estimated_duration_seconds) {
    return { seconds: task.estimated_duration_seconds, source: task.estimate_source ?? "auto" };
  }

  // No history yet → fall back to a risk-keyed default. Keeps the
  // initial "il reste 2 min" / "5 min" / "20 min" pills realistic
  // until enough runs land to compute a per-repo median.
  return { seconds: fallbackForRisk(task.risk), source: "auto", sample_size: 0 };
}

export function estimateTask(
  backlogDir: string,
  taskId: string,
  ctx?: EstimatorContext,
): { seconds: number; task_count: number } {
  const { tasksById } = loadContext(backlogDir, ctx);
  const tasks = Array.from(tasksById.values()).filter((task) => task.task_id === taskId);
  const open = tasks.filter((task) => task.status !== "completed" && task.status !== "canceled");
  let seconds = 0;
  for (const task of open) {
    seconds += estimateSubTask(backlogDir, task, ctx).seconds;
  }
  return { seconds, task_count: open.length };
}
