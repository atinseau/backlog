import fs from "node:fs";
import path from "node:path";
import { archiveClaim, listActiveClaims, removeContextFile } from "@backlog/claims";
import { detectGitDir } from "@backlog/git";
import { loadConfig } from "@backlog/config";
import { repoCheckoutPath } from "@backlog/schemas";
import type { GitMergeStrategy, ProjectConfig, Run } from "@backlog/schemas";
import { execa } from "execa";
import { cascadeBlockDependents, getSubTask, updateSubTask, updateSubTaskStatus } from "./subtask-service.js";
import { getTask, updateTaskStatus } from "./task-service.js";
import { addRunArtifact, appendRunEvent, archiveRun, getRunHandoffPath, loadRun, updateRunStatus, writeRunHandoff } from "./run-store.js";
import { cleanupRunWorktree, commitWorktreeChanges, createPullRequest, mergeRunBranch, pushWorktreeBranch, sanitizeRunBranch } from "./run-merge.js";
import { cleanupRemoteExecutionCheckout, remoteExecutionBasePath } from "./worktrees.js";
import { runSubTaskId, runTargetType } from "./execution-target.js";

function failureBlocker(runId: string, summary?: string): string {
  const clean = (summary ?? "Run failed").replace(/\s+/g, " ").trim();
  return `run_failed:${runId}:${clean.slice(0, 180)}`;
}

function taskStatusAfterRun(status: "review" | "completed" | "blocked"): "review" | "done" | "blocked" {
  if (status === "review") return "review";
  if (status === "completed") return "done";
  return "blocked";
}

function syncParentWorkAfterRun(backlogDir: string, run: Run, status: "review" | "completed" | "blocked"): void {
  if (runTargetType(run) === "task") {
    updateTaskStatus(backlogDir, run.task_id, taskStatusAfterRun(status));
    return;
  }
  const subtaskId = runSubTaskId(run);
  if (!subtaskId) return;
  const task = getSubTask(backlogDir, subtaskId);
  if (!task) return;
  if (status === "review") {
    updateSubTaskStatus(backlogDir, subtaskId, "review");
    updateTaskStatus(backlogDir, task.task_id, "review");
    return;
  }
  if (status === "completed") {
    updateSubTaskStatus(backlogDir, subtaskId, "completed");
    updateTaskStatus(backlogDir, task.task_id, "done");
    return;
  }
  updateSubTaskStatus(backlogDir, subtaskId, "blocked");
  updateTaskStatus(backlogDir, task.task_id, "blocked");
}

function resetRunTarget(backlogDir: string, run: Run): void {
  if (runTargetType(run) === "task") {
    updateTaskStatus(backlogDir, run.task_id, "ready");
    return;
  }
  const subtaskId = runSubTaskId(run);
  if (subtaskId) updateSubTaskStatus(backlogDir, subtaskId, "planned");
  updateTaskStatus(backlogDir, run.task_id, "ready");
}

function replanRunTarget(backlogDir: string, run: Run): void {
  if (runTargetType(run) === "task") {
    updateTaskStatus(backlogDir, run.task_id, "ready");
    return;
  }
  const subtaskId = runSubTaskId(run);
  if (subtaskId) updateSubTaskStatus(backlogDir, subtaskId, "planned");
  updateTaskStatus(backlogDir, run.task_id, "in_progress");
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
  syncParentWorkAfterRun(backlogDir, run, "completed");
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

function executionRepoPathForRun(backlogDir: string, repo: ProjectConfig["repos"][number], run: Run): string | undefined {
  const checkoutPath = repoCheckoutPath(repo);
  if (checkoutPath) return checkoutPath;
  const remoteBase = remoteExecutionBasePath(backlogDir, run.repo, run.id);
  return fs.existsSync(remoteBase) ? remoteBase : undefined;
}

async function remoteBranchExists(worktreePath: string, branch: string): Promise<boolean> {
  const result = await gitRun(worktreePath, ["ls-remote", "--heads", "origin", branch]);
  return result.exitCode === 0 && result.stdout.trim().length > 0;
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
      throw new Error(`Unknown repository '${run.repo}' for run ${run.id}`);
    }
    const checkoutPath = repoCheckoutPath(repo);
    if (!checkoutPath) {
      appendRunEvent(backlogDir, runId, {
        ts: new Date().toISOString(),
        type: "run.merge_skipped",
        message: `Repository '${run.repo}' has no local checkout — remote branch/PR remains available for review`,
      });
    } else {
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
        repoPath: checkoutPath,
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
  }

  await completeRun(backlogDir, runId, summary ?? "Approved in review");

  // Worktree cleanup is best-effort after the approval has succeeded.
  // Merge failures above throw before completion so the run stays in
  // awaiting_review and the user can fix/retry instead of losing sight
  // of unapplied work.
  try {
    if (!repo) return;
    const persistentCheckoutPath = repoCheckoutPath(repo);
    const checkoutPath = executionRepoPathForRun(backlogDir, repo, run);
    if (!checkoutPath) return;

    if (run.execution_mode !== "direct" && config.git.cleanup_worktree_on_approve) {
      if (!persistentCheckoutPath && !(await remoteBranchExists(run.worktree_path, run.branch))) {
        appendRunEvent(backlogDir, runId, {
          ts: new Date().toISOString(),
          type: "worktree.cleanup_skipped",
          message: `Temporary checkout kept because branch ${run.branch} is not on origin`,
        });
        return;
      }
      // Only delete the branch when merge was requested. In no-merge
      // mode the branch is the user's only copy of the work.
      const cleanup = await cleanupRunWorktree({
        worktreePath: run.worktree_path,
        branch: run.branch,
        repoPath: checkoutPath,
        deleteBranch: config.git.merge_strategy !== "none" && config.git.delete_branch_after_merge,
      });
      appendRunEvent(backlogDir, runId, {
        ts: new Date().toISOString(),
        type: cleanup.removedWorktree ? "worktree.removed" : "worktree.cleanup_failed",
        message: cleanup.removedWorktree
          ? `Removed worktree${cleanup.deletedBranch ? ` and branch ${run.branch}` : ""}`
          : `Failed to remove worktree: ${cleanup.error ?? "unknown"}`,
      });
      if (cleanupRemoteExecutionCheckout(backlogDir, run.repo, run.id)) {
        appendRunEvent(backlogDir, runId, {
          ts: new Date().toISOString(),
          type: "workspace.remote_checkout_removed",
          message: `Removed temporary checkout for remote repository ${run.repo}`,
        });
      }
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
  resetRunTarget(backlogDir, run);
  await releaseRunClaims(backlogDir, runId);
  archiveRun(backlogDir, runId);
}

async function gitRun(cwd: string, args: string[]): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  const result = await execa("git", args, { cwd, reject: false });
  return { exitCode: result.exitCode ?? null, stdout: result.stdout, stderr: result.stderr };
}

async function hasGitMetadata(cwd: string): Promise<boolean> {
  try {
    await detectGitDir(cwd);
    return true;
  } catch {
    return false;
  }
}

function patchArtifactPath(run: Run): string | null {
  const artifact = [...run.artifacts].reverse().find((item) => item.kind === "patch");
  if (!artifact) return null;
  return path.isAbsolute(artifact.value)
    ? artifact.value
    : path.join(run.worktree_path, artifact.value);
}

function safeRunRelativePath(rootPath: string, value: string): { rel: string; abs: string } | null {
  const root = path.resolve(rootPath);
  const abs = path.isAbsolute(value) ? path.resolve(value) : path.resolve(root, value);
  const rel = path.relative(root, abs);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return { rel: rel.split(path.sep).join("/"), abs };
}

function runFileArtifacts(run: Run): Array<{ rel: string; abs: string }> {
  const seen = new Set<string>();
  const files: Array<{ rel: string; abs: string }> = [];
  for (const artifact of run.artifacts) {
    if (artifact.kind !== "file") continue;
    const file = safeRunRelativePath(run.worktree_path, artifact.value);
    if (!file || seen.has(file.rel)) continue;
    seen.add(file.rel);
    files.push(file);
  }
  return files;
}

function distinctCommitArtifacts(run: Run): string[] {
  const seen = new Set<string>();
  const commits: string[] = [];
  for (const artifact of run.artifacts) {
    if (artifact.kind !== "commit" || !artifact.value) continue;
    if (seen.has(artifact.value)) continue;
    seen.add(artifact.value);
    commits.push(artifact.value);
  }
  return commits;
}

function nonBacklogStatusLines(stdout: string): string[] {
  return stdout.split("\n").map((line) => line.trim()).filter((line) => {
    if (!line) return false;
    const file = line.slice(3).trim().replace(/^"|"$/g, "");
    return file !== ".backlog" && !file.startsWith(".backlog/");
  });
}

async function discardDirectRunChanges(run: Run): Promise<string> {
  const commitArtifacts = distinctCommitArtifacts(run);
  const latestCommit = commitArtifacts.length > 1 ? commitArtifacts.at(-1) : undefined;
  if (latestCommit) {
    const head = await gitRun(run.worktree_path, ["rev-parse", "HEAD"]);
    if (head.exitCode === 0 && head.stdout.trim() === latestCommit) {
      const status = await gitRun(run.worktree_path, ["status", "--porcelain"]);
      const dirty = nonBacklogStatusLines(status.stdout);
      if (dirty.length > 0) {
        throw new Error(
          `Impossible d'annuler automatiquement ${run.id} : le checkout contient des changements locaux après le run. ` +
          `Commit/stash ces changements, puis relance l'annulation ou fais un revert manuel du commit ${latestCommit.slice(0, 7)}.`,
        );
      }
      const parent = await gitRun(run.worktree_path, ["rev-parse", `${latestCommit}^`]);
      if (parent.exitCode !== 0 || !parent.stdout.trim()) {
        throw new Error(`Impossible d'annuler automatiquement ${run.id} : le commit ${latestCommit.slice(0, 7)} n'a pas de parent.`);
      }
      const reset = await gitRun(run.worktree_path, ["reset", "--hard", parent.stdout.trim()]);
      if (reset.exitCode !== 0) {
        throw new Error(`git reset a échoué : ${(reset.stderr || reset.stdout).trim().slice(0, 400)}`);
      }
      return `Reset direct checkout from ${latestCommit.slice(0, 7)} to ${parent.stdout.trim().slice(0, 7)}`;
    }
    throw new Error(
      `Impossible d'annuler automatiquement ${run.id} : le commit du run ${latestCommit.slice(0, 7)} n'est plus le HEAD du checkout. ` +
      "Un autre commit est arrivé après lui ; fais un revert manuel pour éviter d'effacer du travail plus récent.",
    );
  }

  const patchPath = patchArtifactPath(run);
  if (patchPath && fs.existsSync(patchPath)) {
    const check = await gitRun(run.worktree_path, ["apply", "--reverse", "--check", patchPath]);
    if (check.exitCode !== 0) {
      throw new Error(
        `Impossible d'annuler automatiquement ${run.id} : le patch du run ne s'applique plus à l'envers. ` +
        `Le checkout a probablement changé depuis. Détail : ${(check.stderr || check.stdout).trim().slice(0, 300)}`,
      );
    }
    const apply = await gitRun(run.worktree_path, ["apply", "--reverse", patchPath]);
    if (apply.exitCode !== 0) {
      throw new Error(`git apply --reverse a échoué : ${(apply.stderr || apply.stdout).trim().slice(0, 400)}`);
    }
    return `Reversed direct checkout patch for ${run.id}`;
  }

  let restoredFiles = 0;
  for (const { rel, abs } of runFileArtifacts(run)) {
    const tracked = await gitRun(run.worktree_path, ["ls-files", "--error-unmatch", "--", rel]);
    if (tracked.exitCode === 0) {
      const restore = await gitRun(run.worktree_path, ["restore", "--staged", "--worktree", "--", rel]);
      if (restore.exitCode !== 0) {
        throw new Error(`git restore ${rel} a échoué : ${(restore.stderr || restore.stdout).trim().slice(0, 300)}`);
      }
      restoredFiles++;
    } else if (fs.existsSync(abs)) {
      fs.rmSync(abs, { recursive: true, force: true });
      restoredFiles++;
    }
  }
  if (restoredFiles > 0) {
    return `Discarded ${restoredFiles} direct checkout file change(s) for ${run.id}`;
  }

  return `No direct checkout changes to discard for ${run.id}`;
}

export async function discardRun(backlogDir: string, runId: string, summary?: string): Promise<void> {
  const run = loadRun(backlogDir, runId);
  if (!run) {
    throw new Error(`Unknown run: ${runId}`);
  }
  if (run.status !== "awaiting_review") {
    throw new Error(`Run is '${run.status}', not 'awaiting_review' — nothing to discard.`);
  }

  const config = loadConfig(backlogDir);
  const repo = config.repos.find((candidate) => candidate.id === run.repo);
  let discardSummary = "Discarded reviewed run changes";
  if (run.execution_mode === "direct") {
    discardSummary = await discardDirectRunChanges(run);
  } else if (repo && executionRepoPathForRun(backlogDir, repo, run)) {
    const repoPath = executionRepoPathForRun(backlogDir, repo, run)!;
    const cleanup = await cleanupRunWorktree({
      worktreePath: run.worktree_path,
      branch: run.branch,
      repoPath,
      deleteBranch: true,
    });
    cleanupRemoteExecutionCheckout(backlogDir, run.repo, run.id);
    discardSummary = cleanup.removedWorktree
      ? `Removed run worktree${cleanup.deletedBranch ? ` and branch ${run.branch}` : ""}`
      : `Discard requested, but worktree cleanup failed: ${cleanup.error ?? "unknown"}`;
  }

  appendRunEvent(backlogDir, runId, {
    ts: new Date().toISOString(),
    type: "run.discarded",
    message: discardSummary,
  });
  const updated = updateRunStatus(backlogDir, runId, "canceled", summary ?? "Discarded by operator");
  resetRunTarget(backlogDir, updated);
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
  syncParentWorkAfterRun(backlogDir, run, "blocked");
  const subtaskId = runSubTaskId(run);
  const task = subtaskId ? getSubTask(backlogDir, subtaskId) : null;
  if (task) {
    const blocker = failureBlocker(runId, summary);
    if (!task.blockers.includes(blocker)) {
      // Store the latest failure where the board/task detail can show it.
      // The archived run remains the full source of truth.
      const blockers = [...task.blockers.filter((item) => !item.startsWith("run_failed:")), blocker];
      updateSubTask(backlogDir, task.id, { blockers });
    }
  }
  // Optional cascade: mark every (transitive) dependent of the failed
  // subtask as blocked so they don't sit in "waiting" forever. Off by
  // default for backward compat — callers who know the failure is
  // permanent (operator giveup, hard error) can opt in.
  if (options?.cascadeBlock) {
    if (subtaskId) cascadeBlockDependents(backlogDir, subtaskId);
  }
  await releaseRunClaims(backlogDir, runId);
  archiveRun(backlogDir, runId);
}

export async function sendRunToReview(backlogDir: string, runId: string, summary?: string): Promise<void> {
  const run = updateRunStatus(backlogDir, runId, "awaiting_review", summary ?? "Awaiting review");
  syncParentWorkAfterRun(backlogDir, run, "review");
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
  const subtaskId = runSubTaskId(run);
  const subtask = subtaskId ? getSubTask(backlogDir, subtaskId) : null;
  const parent = getTask(backlogDir, run.task_id);
  const repo = loadConfig(backlogDir).repos.find((candidate) => candidate.id === run.repo);
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

  if (!(await hasGitMetadata(run.worktree_path))) {
    appendRunEvent(backlogDir, runId, {
      ts: new Date().toISOString(),
      type: "run.commit_skipped",
      message: "Folder is not a Git repository — changes were left in place without commit or push.",
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
    backlogDir,
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
    ...(subtaskId ? [`Subtask: ${subtaskId}`] : []),
    "",
    "Generated by Backlog.",
  ].join("\n");
  const pr = await createPullRequest({
    worktreePath: run.worktree_path,
    branch: run.branch,
    title,
    body,
    autoMerge: wantsMerge,
    backlogDir,
    ...(repo?.default_branch ? { baseBranch: repo.default_branch } : {}),
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

// Conventional-style commit message generated from the task +
// subtask. Format: "<type>(<repo>): <title>\n\nRun: <runId>\nTask: <taskId>"
// Type defaults to "feat" — backlog runs are predominantly additive
// work; reviewers can rewrite at merge time if they prefer "fix" /
// "chore" etc.
function buildCommitMessage(
  parent: ReturnType<typeof getTask>,
  subtask: ReturnType<typeof getSubTask>,
  run: Pick<Run, "id" | "target_type" | "target_id" | "subtask_id" | "task_id" | "repo">,
): string {
  const title = subtask?.title?.trim() || parent?.title?.trim() || "Backlog run";
  const scope = run.repo;
  const subject = `feat(${scope}): ${title}`.slice(0, 72);
  const trailers: string[] = [
    `Backlog-Run: ${run.id}`,
    `Backlog-Task: ${run.task_id}`,
  ];
  const subtaskId = runSubTaskId(run);
  if (subtaskId && subtask?.planner.origin !== "implicit") {
    trailers.push(`Backlog-Subtask: ${subtaskId}`);
  }
  return `${subject}\n\n${trailers.join("\n")}\n`;
}

export async function requestRunChanges(backlogDir: string, runId: string, reason: string): Promise<string> {
  const run = updateRunStatus(backlogDir, runId, "blocked", reason);
  replanRunTarget(backlogDir, run);
  createRunHandoff(backlogDir, runId, reason);
  archiveRun(backlogDir, runId);
  return getRunHandoffPath(backlogDir, runId) ?? writeRunHandoff(backlogDir, runId, `# Run Handoff\n\nReason: ${reason}\n`);
}

export function createRunHandoff(backlogDir: string, runId: string, reason: string): string {
  const run = loadRun(backlogDir, runId);
  if (!run) {
    throw new Error(`Unknown run: ${runId}`);
  }
  const subtaskId = runSubTaskId(run);
  const task = subtaskId ? getSubTask(backlogDir, subtaskId) : getTask(backlogDir, run.task_id);
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
