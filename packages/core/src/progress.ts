import { type Run, type SubTask } from "@backlog/schemas";

const STATUS_PROGRESS_FALLBACK: Record<SubTask["status"], number> = {
  queued: 0,
  planned: 5,
  running: 50,
  waiting: 30,
  review: 90,
  completed: 100,
  blocked: 0,
  canceled: 0,
};

export interface TaskProgressInput {
  task: SubTask;
  activeRun: Run | null;
  estimateSeconds: number;
  now?: number;
}

export interface TaskProgress {
  percent: number;
  elapsed_seconds: number | null;
  source: "agent" | "elapsed" | "status";
}

export function computeSubTaskProgress(input: TaskProgressInput): TaskProgress {
  const { task, activeRun, estimateSeconds } = input;
  const now = input.now ?? Date.now();

  const elapsed = elapsedSeconds(activeRun, now);

  if (typeof task.progress_percent === "number") {
    return { percent: clamp(task.progress_percent), elapsed_seconds: elapsed, source: "agent" };
  }

  if (task.status === "running" && activeRun?.started_at && estimateSeconds > 0 && elapsed !== null) {
    const ratio = elapsed / estimateSeconds;
    const capped = Math.min(0.95, Math.max(0, ratio));
    return { percent: Math.round(capped * 100), elapsed_seconds: elapsed, source: "elapsed" };
  }

  return {
    percent: STATUS_PROGRESS_FALLBACK[task.status] ?? 0,
    elapsed_seconds: elapsed,
    source: "status",
  };
}

export function elapsedSeconds(run: Run | null, now: number): number | null {
  if (!run?.started_at) return null;
  const startedMs = Date.parse(run.started_at);
  if (!Number.isFinite(startedMs)) return null;
  if (run.finished_at) {
    const finishedMs = Date.parse(run.finished_at);
    if (Number.isFinite(finishedMs)) {
      return Math.max(0, Math.round((finishedMs - startedMs) / 1000));
    }
  }
  return Math.max(0, Math.round((now - startedMs) / 1000));
}

export function etaIso(run: Run | null, estimateSeconds: number): string | null {
  if (!run?.started_at || estimateSeconds <= 0) return null;
  const startedMs = Date.parse(run.started_at);
  if (!Number.isFinite(startedMs)) return null;
  return new Date(startedMs + estimateSeconds * 1000).toISOString();
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

export interface WorkItemProgressInput {
  taskProgresses: Array<{ percent: number; estimateSeconds: number }>;
}

export function computeWorkItemProgress(input: WorkItemProgressInput): number {
  const { taskProgresses } = input;
  if (taskProgresses.length === 0) return 0;
  const totalDuration = taskProgresses.reduce((sum, t) => sum + Math.max(0, t.estimateSeconds), 0);
  if (totalDuration === 0) {
    const flat = taskProgresses.reduce((sum, t) => sum + t.percent, 0) / taskProgresses.length;
    return clamp(flat);
  }
  const weighted =
    taskProgresses.reduce((sum, t) => sum + t.percent * Math.max(0, t.estimateSeconds), 0) / totalDuration;
  return clamp(weighted);
}
