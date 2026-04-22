import { archiveClaim, listActiveClaims, removeContextFile } from "@cockpit-ai/claims";
import { detectGitDir } from "@cockpit-ai/git";
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

async function releaseRunClaims(cockpitDir: string, runId: string): Promise<void> {
  const run = loadRun(cockpitDir, runId);
  if (!run) {
    throw new Error(`Unknown run: ${runId}`);
  }

  const activeClaims = new Map(listActiveClaims(cockpitDir).map((claim) => [claim.id, claim]));
  for (const claimId of run.claim_ids) {
    const claim = activeClaims.get(claimId);
    if (!claim) {
      continue;
    }
    archiveClaim(cockpitDir, claimId);

    try {
      const repoGitDir = await detectGitDir(claim.repo_path);
      removeContextFile(repoGitDir, claimId);
    } catch {
      // Ignore repo cleanup failures; the archived claim is already authoritative.
    }

    try {
      const worktreeGitDir = await detectGitDir(run.worktree_path);
      removeContextFile(worktreeGitDir, claimId);
    } catch {
      // Ignore worktree cleanup failures; the archived claim is already authoritative.
    }
  }
}

export async function completeRun(cockpitDir: string, runId: string, summary?: string): Promise<void> {
  const run = updateRunStatus(cockpitDir, runId, "succeeded", summary ?? "Completed by operator");
  syncParentWorkAfterRun(cockpitDir, run.task_id, "completed");
  await releaseRunClaims(cockpitDir, runId);
  archiveRun(cockpitDir, runId);
}

export async function failRun(cockpitDir: string, runId: string, summary?: string): Promise<void> {
  const run = updateRunStatus(cockpitDir, runId, "failed", summary ?? "Failed by operator");
  syncParentWorkAfterRun(cockpitDir, run.task_id, "blocked");
  await releaseRunClaims(cockpitDir, runId);
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
