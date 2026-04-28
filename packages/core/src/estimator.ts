import { type Run, type SubTask } from "@backlog/schemas";
import { listArchivedRuns } from "./run-store.js";
import { listSubTasks } from "./state-files.js";

export const FALLBACK_TASK_DURATION_SECONDS = 30 * 60;

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
  if (run.status !== "succeeded") return null;
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
  const archivedRuns = ctx?.archivedRuns ?? listArchivedRuns(backlogDir);
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
    // `run.task_id` is the parent work item's id, which would never hit.
    const runTask = tasksById.get(run.subtask_id);
    if (lane && runTask?.execution.lane === lane) {
      sameLaneSameRepo.push(duration);
    }
  }

  const tightMedian = sameLaneSameRepo.length >= 3 ? median(sameLaneSameRepo) : null;
  const looseMedian = sameRepo.length >= 3 ? median(sameRepo) : null;

  if (tightMedian !== null) {
    return { seconds: Math.round(tightMedian), source: "auto", sample_size: sameLaneSameRepo.length };
  }
  if (looseMedian !== null) {
    return { seconds: Math.round(looseMedian), source: "auto", sample_size: sameRepo.length };
  }

  if (task.estimated_duration_seconds) {
    return { seconds: task.estimated_duration_seconds, source: task.estimate_source ?? "auto" };
  }

  return { seconds: FALLBACK_TASK_DURATION_SECONDS, source: "auto", sample_size: 0 };
}

export function estimateWorkItem(
  backlogDir: string,
  workItemId: string,
  ctx?: EstimatorContext,
): { seconds: number; task_count: number } {
  const { tasksById } = loadContext(backlogDir, ctx);
  const tasks = Array.from(tasksById.values()).filter((task) => task.task_id === workItemId);
  const open = tasks.filter((task) => task.status !== "completed" && task.status !== "canceled");
  let seconds = 0;
  for (const task of open) {
    seconds += estimateSubTask(backlogDir, task, ctx).seconds;
  }
  return { seconds, task_count: open.length };
}
