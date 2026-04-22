import { getTask, updateTaskStatus } from "./task-service.js";
import { updateWorkItemStatus } from "./work-service.js";
import { archiveRun, loadRun, updateRunStatus, writeRunHandoff } from "./run-store.js";

function syncParentWorkAfterRun(cockpitDir: string, taskId: string, status: "review" | "completed" | "blocked"): void {
  const task = getTask(cockpitDir, taskId);
  if (!task) {
    return;
  }
  if (status === "review") {
    updateTaskStatus(cockpitDir, taskId, "review");
    updateWorkItemStatus(cockpitDir, task.work_item_id, "review");
    return;
  }
  if (status === "completed") {
    updateTaskStatus(cockpitDir, taskId, "completed");
    updateWorkItemStatus(cockpitDir, task.work_item_id, "done");
    return;
  }
  updateTaskStatus(cockpitDir, taskId, "blocked");
  updateWorkItemStatus(cockpitDir, task.work_item_id, "blocked");
}

export function completeRun(cockpitDir: string, runId: string, summary?: string): void {
  const run = updateRunStatus(cockpitDir, runId, "succeeded", summary ?? "Completed by operator");
  syncParentWorkAfterRun(cockpitDir, run.task_id, "completed");
  archiveRun(cockpitDir, runId);
}

export function failRun(cockpitDir: string, runId: string, summary?: string): void {
  const run = updateRunStatus(cockpitDir, runId, "failed", summary ?? "Failed by operator");
  syncParentWorkAfterRun(cockpitDir, run.task_id, "blocked");
  archiveRun(cockpitDir, runId);
}

export function sendRunToReview(cockpitDir: string, runId: string, summary?: string): void {
  const run = updateRunStatus(cockpitDir, runId, "awaiting_review", summary ?? "Awaiting review");
  syncParentWorkAfterRun(cockpitDir, run.task_id, "review");
}

export function createRunHandoff(cockpitDir: string, runId: string, reason: string): string {
  const run = loadRun(cockpitDir, runId);
  if (!run) {
    throw new Error(`Unknown run: ${runId}`);
  }
  const task = run ? getTask(cockpitDir, run.task_id) : null;
  const handoff = [
    `# Run Handoff`,
    ``,
    `Run: ${runId}`,
    `Reason: ${reason}`,
    ``,
    `## Next action`,
    `- Review the run artifacts and decide whether to resume, complete, or replace the task.`,
    task ? `- Related task: ${task.id}` : ``,
  ].filter(Boolean).join("\n");
  return writeRunHandoff(cockpitDir, runId, handoff);
}
