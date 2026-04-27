import { archiveClaim, listActiveClaims, removeContextFile } from "@backlog/claims";
import { detectGitDir } from "@backlog/git";
import { getSubTask, updateSubTaskStatus } from "./subtask-service.js";
import { updateWorkItemStatus } from "./work-service.js";
import { archiveRun, getRunHandoffPath, loadRun, updateRunStatus, writeRunHandoff } from "./run-store.js";

function syncParentWorkAfterRun(backlogDir: string, taskId: string, status: "review" | "completed" | "blocked"): void {
  const task = getSubTask(backlogDir, taskId);
  if (!task) {
    return;
  }
  if (status === "review") {
    updateSubTaskStatus(backlogDir, taskId, "review");
    updateWorkItemStatus(backlogDir, task.work_item_id, "review");
    return;
  }
  if (status === "completed") {
    updateSubTaskStatus(backlogDir, taskId, "completed");
    updateWorkItemStatus(backlogDir, task.work_item_id, "done");
    return;
  }
  updateSubTaskStatus(backlogDir, taskId, "blocked");
  updateWorkItemStatus(backlogDir, task.work_item_id, "blocked");
}

async function releaseRunClaims(backlogDir: string, runId: string): Promise<void> {
  const run = loadRun(backlogDir, runId);
  if (!run) {
    throw new Error(`Unknown run: ${runId}`);
  }

  const activeClaims = new Map(listActiveClaims(backlogDir).map((claim) => [claim.id, claim]));
  for (const claimId of run.claim_ids) {
    const claim = activeClaims.get(claimId);
    if (!claim) {
      continue;
    }
    archiveClaim(backlogDir, claimId);

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

export async function completeRun(backlogDir: string, runId: string, summary?: string): Promise<void> {
  const run = updateRunStatus(backlogDir, runId, "succeeded", summary ?? "Completed by operator");
  syncParentWorkAfterRun(backlogDir, run.task_id, "completed");
  await releaseRunClaims(backlogDir, runId);
  archiveRun(backlogDir, runId);
}

export async function approveRun(backlogDir: string, runId: string, summary?: string): Promise<void> {
  await completeRun(backlogDir, runId, summary ?? "Approved in review");
}

export async function failRun(backlogDir: string, runId: string, summary?: string): Promise<void> {
  const run = updateRunStatus(backlogDir, runId, "failed", summary ?? "Failed by operator");
  syncParentWorkAfterRun(backlogDir, run.task_id, "blocked");
  await releaseRunClaims(backlogDir, runId);
  archiveRun(backlogDir, runId);
}

export async function sendRunToReview(backlogDir: string, runId: string, summary?: string): Promise<void> {
  const run = updateRunStatus(backlogDir, runId, "awaiting_review", summary ?? "Awaiting review");
  syncParentWorkAfterRun(backlogDir, run.task_id, "review");
  await releaseRunClaims(backlogDir, runId);
}

export async function finalizeSuccessfulRun(
  backlogDir: string,
  runId: string,
  summary: string | undefined,
  successMode: "review" | "complete",
): Promise<void> {
  if (successMode === "complete") {
    await completeRun(backlogDir, runId, summary);
    return;
  }
  await sendRunToReview(backlogDir, runId, summary);
}

export async function requestRunChanges(backlogDir: string, runId: string, reason: string): Promise<string> {
  const run = updateRunStatus(backlogDir, runId, "blocked", reason);
  updateSubTaskStatus(backlogDir, run.task_id, "planned");
  createRunHandoff(backlogDir, runId, reason);
  archiveRun(backlogDir, runId);
  return getRunHandoffPath(backlogDir, runId) ?? writeRunHandoff(backlogDir, runId, `# Run Handoff\n\nReason: ${reason}\n`);
}

export function createRunHandoff(backlogDir: string, runId: string, reason: string): string {
  const run = loadRun(backlogDir, runId);
  if (!run) {
    throw new Error(`Unknown run: ${runId}`);
  }
  const task = run ? getSubTask(backlogDir, run.task_id) : null;
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
  return writeRunHandoff(backlogDir, runId, handoff);
}
