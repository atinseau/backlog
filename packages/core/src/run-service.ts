import { archiveClaim, listActiveClaims, removeContextFile } from "@backlog/claims";
import { detectGitDir } from "@backlog/git";
import { loadConfig } from "@backlog/config";
import type { GitMergeStrategy, ProjectConfig } from "@backlog/schemas";
import { cascadeBlockDependents, getSubTask, updateSubTask, updateSubTaskStatus } from "./subtask-service.js";
import { getTask, updateTaskStatus } from "./task-service.js";
import { addRunArtifact, appendRunEvent, archiveRun, getRunHandoffPath, loadRun, updateRunStatus, writeRunHandoff } from "./run-store.js";
import { cleanupRunWorktree, commitWorktreeChanges, createPullRequest, mergeRunBranch, pushWorktreeBranch, sanitizeRunBranch } from "./run-merge.js";

function failureBlocker(runId: string, summary?: string): string {
  const clean = (summary ?? "Run failed").replace(/\s+/g, " ").trim();
  return `run_failed:${runId}:${clean.slice(0, 180)}`;
}

function syncParentWorkAfterRun(backlogDir: string, taskId: string, status: "review" | "completed" | "blocked"): void {
  const task = getSubTask(backlogDir, taskId);
  if (!task) {
    return;
  }
  if (status === "review") {
    updateSubTaskStatus(backlogDir, taskId, "review");
    updateTaskStatus(backlogDir, task.task_id, "review");
    return;
  }
  if (status === "completed") {
    updateSubTaskStatus(backlogDir, taskId, "completed");
    updateTaskStatus(backlogDir, task.task_id, "done");
    return;
  }
  updateSubTaskStatus(backlogDir, taskId, "blocked");
  updateTaskStatus(backlogDir, task.task_id, "blocked");
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
  syncParentWorkAfterRun(backlogDir, run.subtask_id, "completed");
  await releaseRunClaims(backlogDir, runId);
  archiveRun(backlogDir, runId);
}

export interface ApproveRunOptions {
  mergeStrategy?: GitMergeStrategy;
}

function withMergeStrategy(config: ProjectConfig, override?: GitMergeStrategy): ProjectConfig {
  if (!override) return config;
  return {
    ...config,
    git: {
      ...config.git,
      merge_strategy: override,
    },
  };
}

export async function approveRun(backlogDir: string, runId: string, summary?: string, options?: ApproveRunOptions): Promise<void> {
  // Capture the run + repo before completeRun moves it to archive,
  // because merge + cleanup need the active worktree path.
  const run = loadRun(backlogDir, runId);
  if (!run) return;

  const baseConfig = loadConfig(backlogDir);
  const config = withMergeStrategy(baseConfig, options?.mergeStrategy);
  const repo = config.repos.find((r) => r.id === run.repo);

  if (run.execution_mode !== "direct" && config.git.merge_strategy !== "none") {
    if (!repo) {
      throw new Error(`Unknown repo '${run.repo}' for run ${run.id}`);
    }
    const sanitize = await sanitizeRunBranch({ worktreePath: run.worktree_path });
    if (!sanitize.ok) {
      throw new Error(`Run branch cleanup failed: ${sanitize.error ?? "unknown"}${sanitize.detail ? ` — ${sanitize.detail}` : ""}`);
    }
    if (sanitize.changed) {
      if (sanitize.sha) addRunArtifact(backlogDir, runId, { kind: "commit", value: sanitize.sha });
      appendRunEvent(backlogDir, runId, {
        ts: new Date().toISOString(),
        type: "run.sanitized",
        message: "Removed Backlog internal artifacts before applying",
      });
    }
    const mergeResult = await mergeRunBranch({
      run,
      repoPath: repo.path,
      repoDefaultBranch: repo.default_branch,
      config,
    });
    if (mergeResult) {
      appendRunEvent(backlogDir, runId, {
        ts: new Date().toISOString(),
        type: mergeResult.ok ? "run.merged" : "run.merge_failed",
        message: mergeResult.ok
          ? `Merged ${mergeResult.branch} → ${mergeResult.target} (${mergeResult.strategy})`
          : `Merge into ${mergeResult.target} failed: ${mergeResult.error ?? "unknown"}`,
      });
      if (!mergeResult.ok) {
        const detail = mergeResult.detail ? ` — ${mergeResult.detail}` : "";
        throw new Error(`Merge failed: ${mergeResult.error ?? "unknown"}${detail}`);
      }
    }
  }

  await completeRun(backlogDir, runId, summary ?? "Approved in review");

  // Worktree cleanup is best-effort after the approval has succeeded.
  // Merge failures above throw before completion so the run stays in
  // awaiting_review and the user can fix/retry instead of losing sight
  // of unapplied work.
  try {
    if (!repo) return;

    if (run.execution_mode !== "direct" && config.git.cleanup_worktree_on_approve) {
      // Only delete the branch when merge was requested. In no-merge
      // mode the branch is the user's only copy of the work.
      const cleanup = await cleanupRunWorktree({
        worktreePath: run.worktree_path,
        branch: run.branch,
        repoPath: repo.path,
        deleteBranch: config.git.merge_strategy !== "none" && config.git.delete_branch_after_merge,
      });
      appendRunEvent(backlogDir, runId, {
        ts: new Date().toISOString(),
        type: cleanup.removedWorktree ? "worktree.removed" : "worktree.cleanup_failed",
        message: cleanup.removedWorktree
          ? `Removed worktree${cleanup.deletedBranch ? ` and branch ${run.branch}` : ""}`
          : `Failed to remove worktree: ${cleanup.error ?? "unknown"}`,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appendRunEvent(backlogDir, runId, {
      ts: new Date().toISOString(),
      type: "run.merge_failed",
      message: `Post-approve git work failed: ${message}`,
    });
  }
}

// User-initiated cancel. Differs from failRun in that the parent
// sub-task goes back to "planned" (not blocked) so it can be picked
// up again, and we never cascade-block dependents — the user said
// "stop this one", not "give up on the chain".
export async function cancelRun(backlogDir: string, runId: string, summary?: string): Promise<void> {
  const run = updateRunStatus(backlogDir, runId, "canceled", summary ?? "Canceled by operator");
  updateSubTaskStatus(backlogDir, run.subtask_id, "planned");
  updateTaskStatus(backlogDir, run.task_id, "ready");
  await releaseRunClaims(backlogDir, runId);
  archiveRun(backlogDir, runId);
}

export async function failRun(
  backlogDir: string,
  runId: string,
  summary?: string,
  options?: { cascadeBlock?: boolean },
): Promise<void> {
  const run = updateRunStatus(backlogDir, runId, "failed", summary ?? "Failed by operator");
  syncParentWorkAfterRun(backlogDir, run.subtask_id, "blocked");
  const task = getSubTask(backlogDir, run.subtask_id);
  if (task) {
    const blocker = failureBlocker(runId, summary);
    if (!task.blockers.includes(blocker)) {
      // Store the latest failure where the board/task detail can show it.
      // The archived run remains the full source of truth.
      const blockers = [...task.blockers.filter((item) => !item.startsWith("run_failed:")), blocker];
      updateSubTask(backlogDir, run.subtask_id, { blockers });
    }
  }
  // Optional cascade: mark every (transitive) dependent of the failed
  // subtask as blocked so they don't sit in "waiting" forever. Off by
  // default for backward compat — callers who know the failure is
  // permanent (operator giveup, hard error) can opt in.
  if (options?.cascadeBlock) {
    cascadeBlockDependents(backlogDir, run.subtask_id);
  }
  await releaseRunClaims(backlogDir, runId);
  archiveRun(backlogDir, runId);
}

export async function sendRunToReview(backlogDir: string, runId: string, summary?: string): Promise<void> {
  const run = updateRunStatus(backlogDir, runId, "awaiting_review", summary ?? "Awaiting review");
  syncParentWorkAfterRun(backlogDir, run.subtask_id, "review");
  await releaseRunClaims(backlogDir, runId);
}

export async function finalizeSuccessfulRun(
  backlogDir: string,
  runId: string,
  summary: string | undefined,
  successMode: "review" | "complete",
): Promise<void> {
  // Commit + push BEFORE moving the run to the next state. Otherwise,
  // when the user later approves, the worktree gets cleaned up and
  // any uncommitted edits the agent made are lost. Both steps honour
  // the per-task `commit_when_done` / `push_when_done` flags
  // (defaulted to true on the parent task), and both are best-effort
  // — failure logs an event but doesn't block the run from
  // completing.
  await runPostExecutorGitWork(backlogDir, runId);

  if (successMode === "complete") {
    await completeRun(backlogDir, runId, summary);
    return;
  }
  await sendRunToReview(backlogDir, runId, summary);
}

async function runPostExecutorGitWork(backlogDir: string, runId: string): Promise<void> {
  const run = loadRun(backlogDir, runId);
  if (!run) return;
  const subtask = getSubTask(backlogDir, run.subtask_id);
  const parent = subtask ? getTask(backlogDir, subtask.task_id) : null;
  // Default: commit + push on. Tasks created before the schema change
  // don't have these fields; preserve "commit by default" behaviour.
  const commitWhenDone = parent?.execution_defaults?.auto_commit ?? true;
  const pushWhenDone = parent?.execution_defaults?.push_when_done ?? true;
  if (!commitWhenDone) {
    appendRunEvent(backlogDir, runId, {
      ts: new Date().toISOString(),
      type: "run.commit_skipped",
      message: run.execution_mode === "direct"
        ? "Commit disabled — changes were left in the main checkout"
        : "Commit disabled — changes were left in the execution workspace",
    });
    return;
  }

  const message = buildCommitMessage(parent, subtask, run);
  const commit = await commitWorktreeChanges({
    worktreePath: run.worktree_path,
    message,
  });
  if (commit.ok && commit.sha) {
    addRunArtifact(backlogDir, runId, { kind: "commit", value: commit.sha });
    appendRunEvent(backlogDir, runId, {
      ts: new Date().toISOString(),
      type: "run.committed",
      message: `Committed run changes ${commit.sha.slice(0, 7)} on ${run.branch}`,
    });
  } else if (commit.ok && !commit.sha) {
    appendRunEvent(backlogDir, runId, {
      ts: new Date().toISOString(),
      type: "run.commit_skipped",
      message: "Nothing to commit — agent left the worktree clean",
    });
    return;
  } else {
    appendRunEvent(backlogDir, runId, {
      ts: new Date().toISOString(),
      type: "run.commit_failed",
      message: `Auto-commit failed: ${commit.error ?? "unknown"}${commit.detail ? ` — ${commit.detail}` : ""}`,
    });
    return;
  }

  if (!pushWhenDone) return;
  const push = await pushWorktreeBranch({
    worktreePath: run.worktree_path,
    branch: run.branch,
  });
  if (push.ok) {
    appendRunEvent(backlogDir, runId, {
      ts: new Date().toISOString(),
      type: "run.pushed",
      message: `Pushed ${run.branch} to origin`,
    });
  } else if (push.error === "no_origin_remote") {
    // Expected for local-only repos. Don't surface as a failure.
    appendRunEvent(backlogDir, runId, {
      ts: new Date().toISOString(),
      type: "run.push_skipped",
      message: "No `origin` remote — push skipped (local-only repo)",
    });
    return;
  } else {
    appendRunEvent(backlogDir, runId, {
      ts: new Date().toISOString(),
      type: "run.push_failed",
      message: `Auto-push failed: ${push.error ?? "unknown"}${push.detail ? ` — ${push.detail}` : ""}`,
    });
    return;
  }

  const wantsPr = parent?.execution_defaults?.create_pr ?? false;
  if (run.execution_mode === "direct" && wantsPr) {
    appendRunEvent(backlogDir, runId, {
      ts: new Date().toISOString(),
      type: "run.pr_skipped",
      message: "PR creation skipped — direct mode works on the current branch",
    });
    return;
  }
  if (!wantsPr) return;
  const wantsMerge = parent?.execution_defaults?.merge_pr ?? false;
  const title = subtask?.title?.trim() || parent?.title?.trim() || `Backlog run ${run.id}`;
  const body = [
    parent?.description?.trim() ? `${parent.description.trim()}\n\n` : "",
    "---",
    `Run: ${run.id}`,
    `Task: ${run.task_id}`,
    `Subtask: ${run.subtask_id}`,
    "",
    "Generated by Backlog.",
  ].join("\n");
  const pr = await createPullRequest({
    worktreePath: run.worktree_path,
    branch: run.branch,
    title,
    body,
    autoMerge: wantsMerge,
  });
  if (pr.ok) {
    if (pr.url) {
      addRunArtifact(backlogDir, runId, { kind: "pr", value: pr.url });
    }
    appendRunEvent(backlogDir, runId, {
      ts: new Date().toISOString(),
      type: pr.merged ? "run.pr_merged" : "run.pr_opened",
      message: pr.merged
        ? `PR opened${pr.url ? ` (${pr.url})` : ""} and queued for merge`
        : `PR opened${pr.url ? ` (${pr.url})` : ""}`,
    });
  } else if (pr.error === "gh_not_installed") {
    appendRunEvent(backlogDir, runId, {
      ts: new Date().toISOString(),
      type: "run.pr_skipped",
      message: "PR creation skipped — install the `gh` CLI and run `gh auth login` to enable.",
    });
  } else {
    appendRunEvent(backlogDir, runId, {
      ts: new Date().toISOString(),
      type: "run.pr_failed",
      message: `PR creation failed: ${pr.error ?? "unknown"}${pr.detail ? ` — ${pr.detail}` : ""}`,
    });
  }
}

// Conventional-style commit message generated from the work item +
// subtask. Format: "<type>(<repo>): <title>\n\nRun: <runId>\nTask: <taskId>"
// Type defaults to "feat" — backlog runs are predominantly additive
// work; reviewers can rewrite at merge time if they prefer "fix" /
// "chore" etc.
function buildCommitMessage(
  parent: ReturnType<typeof getTask>,
  subtask: ReturnType<typeof getSubTask>,
  run: { id: string; subtask_id: string; task_id: string; repo: string },
): string {
  const title = subtask?.title?.trim() || parent?.title?.trim() || "Backlog run";
  const scope = run.repo;
  const subject = `feat(${scope}): ${title}`.slice(0, 72);
  const trailers: string[] = [
    `Backlog-Run: ${run.id}`,
    `Backlog-Task: ${run.task_id}`,
    `Backlog-Subtask: ${run.subtask_id}`,
  ];
  return `${subject}\n\n${trailers.join("\n")}\n`;
}

export async function requestRunChanges(backlogDir: string, runId: string, reason: string): Promise<string> {
  const run = updateRunStatus(backlogDir, runId, "blocked", reason);
  updateSubTaskStatus(backlogDir, run.subtask_id, "planned");
  createRunHandoff(backlogDir, runId, reason);
  archiveRun(backlogDir, runId);
  return getRunHandoffPath(backlogDir, runId) ?? writeRunHandoff(backlogDir, runId, `# Run Handoff\n\nReason: ${reason}\n`);
}

export function createRunHandoff(backlogDir: string, runId: string, reason: string): string {
  const run = loadRun(backlogDir, runId);
  if (!run) {
    throw new Error(`Unknown run: ${runId}`);
  }
  const task = run ? getSubTask(backlogDir, run.subtask_id) : null;
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
