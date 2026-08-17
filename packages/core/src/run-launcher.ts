import { archiveClaim, createClaim, writeContextFile } from "@backlog/claims";
import { detectGitDir, git } from "@backlog/git";
import { repoCheckoutPath } from "@backlog/schemas";
import type { Agent, ProjectConfig } from "@backlog/schemas";
import { getAgent, pickAgentForTask, selectionForAgentTask, supportsAgentExecution } from "./agents.js";
import { executeAgentRun } from "./run-executor.js";
import { appendRunEvent, addRunArtifact, createRun, getRunEvents, isAgentBusyStatus, listActiveRuns, loadRun, nextRunId, updateRunStatus } from "./run-store.js";
import { runWithRetry, retryPolicyForAgent } from "./retry.js";
import type { ExecutionPlan } from "./scheduler.js";
import { getSubTask, updateSubTaskStatus } from "./subtask-service.js";
import { getTask, updateTaskStatus } from "./task-service.js";
import { subTaskExecutionTarget, taskExecutionTarget, type ExecutionTarget } from "./execution-target.js";
import {
  buildRunBranchName,
  cleanupRemoteExecutionCheckout,
  ensureRemoteExecutionCheckout,
  ensureWorktree,
  isGitRemoteRepository,
  writeWorktreeContext,
} from "./worktrees.js";

// How much of the failed run's events tail we feed back into the next
// attempt's prompt. Bounded so a verbose Claude log doesn't explode
// the prompt size.
const RETRY_FEEDBACK_BYTES = 4_000;

async function inspectDirectCheckout(repoPath: string, options: { allowDirty?: boolean } = {}): Promise<
  | { ok: true; branch: string; dirtyFiles?: string[]; git: boolean }
  | { ok: false; reason: string }
> {
  let branch: string;
  try {
    branch = await git(["symbolic-ref", "--short", "HEAD"], repoPath);
  } catch {
    try {
      await detectGitDir(repoPath);
      return { ok: false, reason: "direct_checkout_detached_head" };
    } catch {
      return { ok: true, branch: "local-folder", git: false };
    }
  }

  // Direct mode writes into the user's checkout, and auto-commit uses
  // `git add -A`. Refuse local dirt before the run so unrelated human
  // work cannot be swept into the agent commit. `.backlog/` is allowed
  // because embedded workspaces keep their own state inside the repo.
  const status = await git(["status", "--porcelain"], repoPath);
  const dirty = status.split("\n").map((line) => line.trim()).filter((line) => {
    if (!line) return false;
    const file = line.slice(3).trim().replace(/^"|"$/g, "");
    return file !== ".backlog" && !file.startsWith(".backlog/");
  });
  if (dirty.length > 0) {
    if (options.allowDirty) {
      return { ok: true, branch, dirtyFiles: dirty, git: true };
    }
    return { ok: false, reason: "direct_checkout_dirty" };
  }

  return { ok: true, branch, git: true };
}

async function hasGitMetadata(repoPath: string): Promise<boolean> {
  try {
    await detectGitDir(repoPath);
    return true;
  } catch {
    return false;
  }
}

export interface StartedRun {
  runId: string;
  taskId: string;
  agentId: string;
  branch: string;
  worktreePath: string;
  claimIds: string[];
}

export interface SkippedRun {
  taskId: string;
  reasons: string[];
}

export interface StartRunsResult {
  started: StartedRun[];
  skipped: SkippedRun[];
}

export interface StartRunsForPlanInput {
  backlogDir: string;
  config: ProjectConfig;
  plan: ExecutionPlan;
  maxStart: number;
  /** Override agent for every started run (matches CLI --agent). */
  forcedAgentId?: string;
  /** User explicitly chose to run in direct mode even though git is dirty. */
  allowDirtyDirect?: boolean;
  /** Explicit split batches may run several copies of the same model. */
  allowAgentOversubscribe?: boolean;
  /** Provider-specific reasoning/effort level selected by the user. */
  reasoningEffort?: string;
}

async function resolveAgent(
  backlogDir: string,
  task: ExecutionTarget,
  decisionAgentId: string | undefined,
  forcedAgentId: string | undefined,
  skipped: SkippedRun[],
): Promise<Agent | null> {
  if (forcedAgentId) {
    const selection = selectionForAgentTask(backlogDir, task, forcedAgentId);
    if (!selection) {
      throw new Error(`Unknown agent: ${forcedAgentId}`);
    }
    if (!selection.available) {
      skipped.push({ taskId: task.id, reasons: selection.reasons });
      return null;
    }
    return selection.agent;
  }
  if (decisionAgentId) {
    const assigned = getAgent(backlogDir, decisionAgentId);
    if (!assigned) {
      skipped.push({ taskId: task.id, reasons: [`unknown_assigned_agent:${decisionAgentId}`] });
      return null;
    }
    return assigned;
  }
  return pickAgentForTask(backlogDir, task);
}

function repoForDirectTask(config: ProjectConfig, requestedRepo?: string): string | null {
  return requestedRepo ??
    config.repos.find((repo) => repo.enabled)?.id ??
    config.repos[0]?.id ??
    null;
}

function resolveExecutionTarget(
  backlogDir: string,
  config: ProjectConfig,
  decision: ExecutionPlan["runnable"][number],
): { task: ExecutionTarget; workItem: NonNullable<ReturnType<typeof getTask>> } | null {
  if (decision.targetType === "task") {
    const workItem = getTask(backlogDir, decision.workItemId);
    if (!workItem) return null;
    const repoId = repoForDirectTask(config, workItem.repo_targets[0] ?? decision.repo);
    if (!repoId) return null;
    return { task: taskExecutionTarget(workItem, repoId), workItem };
  }
  const subTask = getSubTask(backlogDir, decision.taskId);
  if (!subTask) return null;
  const workItem = getTask(backlogDir, subTask.task_id);
  if (!workItem) return null;
  return { task: subTaskExecutionTarget(subTask), workItem };
}

function updateExecutionTargetStatus(backlogDir: string, target: ExecutionTarget, status: "queued" | "running" | "blocked"): void {
  if ((target.target_type ?? "subtask") === "subtask") {
    updateSubTaskStatus(backlogDir, target.id, status);
    return;
  }
  if (status === "running") {
    updateTaskStatus(backlogDir, target.task_id, "in_progress");
  } else if (status === "blocked") {
    updateTaskStatus(backlogDir, target.task_id, "blocked");
  } else {
    updateTaskStatus(backlogDir, target.task_id, "ready");
  }
}

export async function startRunsForPlan(input: StartRunsForPlanInput): Promise<StartRunsResult> {
  const { backlogDir, config, plan, maxStart, forcedAgentId, allowDirtyDirect, allowAgentOversubscribe, reasoningEffort } = input;
  const started: StartedRun[] = [];
  const skipped: SkippedRun[] = [];
  const executions: Array<Promise<void>> = [];

  for (const decision of plan.runnable.slice(0, maxStart)) {
    const resolved = resolveExecutionTarget(backlogDir, config, decision);
    if (!resolved) {
      skipped.push({ taskId: decision.taskId, reasons: ["missing_task"] });
      continue;
    }
    const { task, workItem } = resolved;
    const repo = config.repos.find((candidate) => candidate.id === task.repo);
    if (!repo) {
      skipped.push({ taskId: task.id, reasons: [`unknown_repo:${task.repo}`] });
      continue;
    }
    const persistentCheckoutPath = repoCheckoutPath(repo);
    if (!persistentCheckoutPath && !isGitRemoteRepository(repo)) {
      skipped.push({ taskId: task.id, reasons: ["repository_has_no_local_checkout"] });
      continue;
    }

    const agent = await resolveAgent(backlogDir, task, decision.assignedAgentId, forcedAgentId, skipped);
    if (!agent) continue;

    const activeAgentRuns = listActiveRuns(backlogDir).filter((run) => isAgentBusyStatus(run.status));
    const activeForAgent = activeAgentRuns.filter((run) => run.agent_id === agent.id).length;
    const allowedConcurrent = allowAgentOversubscribe
      ? Math.max(agent.max_concurrent_runs, maxStart)
      : agent.max_concurrent_runs;
    if (activeForAgent >= allowedConcurrent) {
      skipped.push({ taskId: task.id, reasons: ["no_agent_capacity"] });
      continue;
    }
    if (!supportsAgentExecution(agent)) {
      skipped.push({ taskId: task.id, reasons: [`unsupported_provider:${agent.provider}`] });
      continue;
    }

    // Generate runId BEFORE the branch name so the branch can include
    // it. Branches are now `backlog/<task>-<slug>-<runId>` which makes
    // every run uniquely-branched even if a prior run on the same
    // subtask failed and left its worktree+branch behind.
    const runId = nextRunId(backlogDir);
    let checkoutPath = persistentCheckoutPath;
    let usingRemoteExecutionCheckout = false;
    if (!checkoutPath) {
      try {
        checkoutPath = await ensureRemoteExecutionCheckout({ backlogDir, repo, runId });
        usingRemoteExecutionCheckout = true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        skipped.push({ taskId: task.id, reasons: [`remote_checkout_failed:${message.slice(0, 200)}`] });
        continue;
      }
    }

    const claim = createClaim({
      backlogDir,
      repo: repo.id,
      repoPath: checkoutPath,
      topic: `run ${task.id}`,
      paths: task.scopes.length > 0 ? task.scopes : ["**"],
      mode: task.claim_mode,
      ttlMinutes: config.claims.ttl_minutes,
      agentId: agent.id,
    });

    const requestedExecutionMode = workItem.execution_defaults?.worktree_mode ?? "direct";
    const checkoutHasGit = await hasGitMetadata(checkoutPath);
    let executionMode = persistentCheckoutPath
      ? (checkoutHasGit ? requestedExecutionMode : "direct")
      : "isolated_worktree";
    let branch = buildRunBranchName(task.id, task.title, runId);
    let worktreePath: string;
    let allowedDirtyDirectFiles: string[] = [];
    let modeAdjustmentMessage: string | null = null;
    try {
      if (executionMode === "direct") {
        const directBusy = checkoutHasGit && (listActiveRuns(backlogDir).some(
          (run) => run.repo === repo.id && run.execution_mode === "direct" && isAgentBusyStatus(run.status),
        ) || started.some((run) => run.worktreePath === checkoutPath));
        if (directBusy) {
          archiveClaim(backlogDir, claim.id);
          skipped.push({ taskId: task.id, reasons: ["direct_checkout_busy"] });
          continue;
        }

        const direct = await inspectDirectCheckout(checkoutPath, allowDirtyDirect ? { allowDirty: true } : {});
        if (!direct.ok) {
          if (direct.reason === "direct_checkout_detached_head" && checkoutHasGit) {
            executionMode = "isolated_worktree";
            modeAdjustmentMessage = "Direct mode is unavailable from a detached HEAD — using an isolated execution workspace.";
            worktreePath = await ensureWorktree({
              backlogDir,
              repoId: repo.id,
              repoPath: checkoutPath,
              branch,
              runId,
            });
          } else {
            archiveClaim(backlogDir, claim.id);
            skipped.push({ taskId: task.id, reasons: [direct.reason] });
            continue;
          }
        } else {
          branch = direct.branch;
          allowedDirtyDirectFiles = direct.dirtyFiles ?? [];
          worktreePath = checkoutPath;
        }
      } else {
        worktreePath = await ensureWorktree({
          backlogDir,
          repoId: repo.id,
          repoPath: checkoutPath,
          branch,
          runId,
        });
      }
    } catch (worktreeError) {
      // Worktree creation failed — most often because the branch
      // already exists from a previous run that didn't clean up. The
      // claim we just created would otherwise leak forever (no run
      // record points at it, so releaseRunClaims never runs). Archive
      // it inline + report a typed skip so the planner doesn't keep
      // re-trying every tick.
      try {
        archiveClaim(backlogDir, claim.id);
      } catch {
        // best-effort: if even archive fails, the user has bigger
        // problems. Don't shadow the original error.
      }
      if (usingRemoteExecutionCheckout) {
        cleanupRemoteExecutionCheckout(backlogDir, repo.id, runId);
      }
      const message = worktreeError instanceof Error ? worktreeError.message : String(worktreeError);
      skipped.push({ taskId: task.id, reasons: [`worktree_failed:${message.slice(0, 200)}`] });
      continue;
    }
    const run = createRun({
      backlogDir,
      runId,
      task,
      workItem,
      agent,
      ...(reasoningEffort ? { reasoningEffort } : {}),
      branch,
      worktreePath,
      claimIds: [claim.id],
      executionMode,
    });
    if (modeAdjustmentMessage) {
      appendRunEvent(backlogDir, run.id, {
        ts: new Date().toISOString(),
        type: "workspace.mode_adjusted",
        message: modeAdjustmentMessage,
      });
    }
    if (reasoningEffort) {
      appendRunEvent(backlogDir, run.id, {
        ts: new Date().toISOString(),
        type: "executor.reasoning",
        message: `effort=${reasoningEffort}`,
      });
    }
    if (checkoutHasGit) {
      try {
        const gitDir = await detectGitDir(checkoutPath);
        writeContextFile(gitDir, {
          version: 1,
          claim_id: claim.id,
          updated_at: new Date().toISOString(),
        });
        await writeWorktreeContext(worktreePath, run.id, claim.id);
      } catch {
        // Context files are an internal safety aid. A write failure
        // should never turn into user-visible Git noise for normal
        // task execution.
      }
    }
    addRunArtifact(backlogDir, run.id, { kind: "branch", value: branch });
    if (usingRemoteExecutionCheckout) {
      appendRunEvent(backlogDir, run.id, {
        ts: new Date().toISOString(),
        type: "workspace.remote_checkout",
        message: `Created temporary checkout for remote repository ${repo.id}`,
      });
      if (requestedExecutionMode === "direct") {
        appendRunEvent(backlogDir, run.id, {
          ts: new Date().toISOString(),
          type: "workspace.mode_adjusted",
          message: "Direct mode is unavailable without a local checkout — using an isolated execution workspace",
        });
      }
    } else if (!checkoutHasGit && requestedExecutionMode !== "direct") {
      appendRunEvent(backlogDir, run.id, {
        ts: new Date().toISOString(),
        type: "workspace.mode_adjusted",
        message: "Isolated Git worktrees are unavailable because this folder is not a Git repository — using direct mode.",
      });
    }
    try {
      const baselineCommit = await git(["rev-parse", "HEAD"], worktreePath);
      if (baselineCommit.trim()) {
        addRunArtifact(backlogDir, run.id, { kind: "commit", value: baselineCommit.trim() });
      }
    } catch {
      // Non-fatal: artifact collection after execution will still
      // capture whatever git state is available for review/discard.
    }
    appendRunEvent(backlogDir, run.id, {
      ts: new Date().toISOString(),
      type: executionMode === "direct" ? "workspace.direct" : "workspace.worktree",
      message: executionMode === "direct"
        ? checkoutHasGit
          ? `Working directly in ${checkoutPath} on ${branch}`
          : `Working directly in ${checkoutPath}`
        : `Working in isolated worktree ${worktreePath}`,
    });
    if (executionMode === "direct" && allowedDirtyDirectFiles.length > 0) {
      appendRunEvent(backlogDir, run.id, {
        ts: new Date().toISOString(),
        type: "workspace.direct_dirty_allowed",
        message: `Continuing despite ${allowedDirtyDirectFiles.length} pre-existing local change(s)`,
      });
    }
    updateRunStatus(backlogDir, run.id, "running", "Execution workspace prepared");
    updateExecutionTargetStatus(backlogDir, task, "running");

    started.push({
      runId: run.id,
      taskId: task.id,
      agentId: agent.id,
      branch,
      worktreePath,
      claimIds: [claim.id],
    });

    // Wrap the executor in the agent's retry policy. Default policy
    // is `mode=none` so existing agents keep their one-shot behaviour.
    // For mode=feedback, each retry reuses the same Run record + the
    // same worktree (so partial work isn't lost) and feeds the
    // previous attempt's tail-of-events into the prompt as context.
    const policy = retryPolicyForAgent(agent);
    let executed = false;
    let unsupported = false;

    executions.push((async () => {
      await runWithRetry({
        policy,
        attempt: async ({ attemptNumber, priorFeedback }) => {
          if (attemptNumber > 1) {
            updateRunStatus(backlogDir, run.id, "running", `Retry attempt ${attemptNumber}`);
            appendRunEvent(backlogDir, run.id, {
              ts: new Date().toISOString(),
              type: "executor.retry",
              message: `Starting retry attempt ${attemptNumber} (policy=${policy.mode}, max=${String(policy.max_attempts)})`,
            });
          }
          const ok = await executeAgentRun({
            backlogDir,
            run,
            task,
            workItem,
            agent,
            ...(priorFeedback ? { priorFailureFeedback: priorFeedback } : {}),
            ...(attemptNumber > 1 ? { attemptNumber } : {}),
          });
          if (!ok) {
            unsupported = true;
            return { ok: true }; // stop the loop; we'll handle below
          }
          executed = true;
          const finalState = loadRun(backlogDir, run.id);
          const status = finalState?.status;
          if (status === "succeeded" || status === "awaiting_review") {
            return { ok: true };
          }
          // Capture a tail of the events.ndjson as feedback for the next
          // attempt. We slice from the end so the most recent failure
          // signals are kept; if it's still too long the buildRetryPrompt
          // helper truncates again at prompt construction time.
          const events = getRunEvents(backlogDir, run.id);
          const feedback = events.slice(-15).join("\n").slice(-RETRY_FEEDBACK_BYTES);
          return { ok: false, feedback };
        },
      });

      if (unsupported) {
        skipped.push({ taskId: task.id, reasons: [`unsupported_provider:${agent.provider}`] });
        updateRunStatus(backlogDir, run.id, "blocked", `Unsupported provider ${agent.provider}`);
        updateExecutionTargetStatus(backlogDir, task, "blocked");
      }
      void executed;
    })());
  }

  await Promise.all(executions);
  return { started, skipped };
}
