import { archiveClaim, createClaim, writeContextFile } from "@backlog/claims";
import { detectGitDir, git } from "@backlog/git";
import type { Agent, SubTask, ProjectConfig } from "@backlog/schemas";
import { getAgent, pickAgentForTask, selectionForAgentTask } from "./agents.js";
import { executeAgentRun, supportsAgentExecution } from "./executor.js";
import { appendRunEvent, addRunArtifact, createRun, getRunEvents, isAgentBusyStatus, listActiveRuns, loadRun, nextRunId, updateRunStatus } from "./run-store.js";
import { runWithRetry, retryPolicyForAgent } from "./retry.js";
import type { ExecutionPlan } from "./scheduler.js";
import { getSubTask, updateSubTaskStatus } from "./subtask-service.js";
import { getTask } from "./task-service.js";
import { buildRunBranchName, ensureWorktree, writeWorktreeContext } from "./worktrees.js";

// How much of the failed run's events tail we feed back into the next
// attempt's prompt. Bounded so a verbose Claude log doesn't explode
// the prompt size.
const RETRY_FEEDBACK_BYTES = 4_000;

async function inspectDirectCheckout(repoPath: string, options: { allowDirty?: boolean } = {}): Promise<
  | { ok: true; branch: string; dirtyFiles?: string[] }
  | { ok: false; reason: string }
> {
  let branch: string;
  try {
    branch = await git(["symbolic-ref", "--short", "HEAD"], repoPath);
  } catch {
    return { ok: false, reason: "direct_checkout_detached_head" };
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
      return { ok: true, branch, dirtyFiles: dirty };
    }
    return { ok: false, reason: "direct_checkout_dirty" };
  }

  return { ok: true, branch };
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
}

async function resolveAgent(
  backlogDir: string,
  task: SubTask,
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

export async function startRunsForPlan(input: StartRunsForPlanInput): Promise<StartRunsResult> {
  const { backlogDir, config, plan, maxStart, forcedAgentId, allowDirtyDirect } = input;
  const started: StartedRun[] = [];
  const skipped: SkippedRun[] = [];

  for (const decision of plan.runnable.slice(0, maxStart)) {
    const task = getSubTask(backlogDir, decision.taskId);
    if (!task) {
      skipped.push({ taskId: decision.taskId, reasons: ["missing_task"] });
      continue;
    }
    const workItem = getTask(backlogDir, task.task_id);
    if (!workItem) {
      skipped.push({ taskId: decision.taskId, reasons: ["missing_work_item"] });
      continue;
    }
    const repo = config.repos.find((candidate) => candidate.id === task.repo);
    if (!repo) {
      skipped.push({ taskId: task.id, reasons: [`unknown_repo:${task.repo}`] });
      continue;
    }

    const agent = await resolveAgent(backlogDir, task, decision.assignedAgentId, forcedAgentId, skipped);
    if (!agent) continue;

    const activeAgentRuns = listActiveRuns(backlogDir).filter((run) => isAgentBusyStatus(run.status));
    if (activeAgentRuns.filter((run) => run.agent_id === agent.id).length >= agent.max_concurrent_runs) {
      skipped.push({ taskId: task.id, reasons: ["no_agent_capacity"] });
      continue;
    }
    if (!supportsAgentExecution(agent)) {
      skipped.push({ taskId: task.id, reasons: [`unsupported_provider:${agent.provider}`] });
      continue;
    }

    const claim = createClaim({
      backlogDir,
      repo: repo.id,
      repoPath: repo.path,
      topic: `run ${task.id}`,
      paths: task.scopes.length > 0 ? task.scopes : ["**"],
      mode: task.claim_mode,
      ttlMinutes: config.claims.ttl_minutes,
      agentId: agent.id,
    });

    // Generate runId BEFORE the branch name so the branch can include
    // it. Branches are now `backlog/<task>-<slug>-<runId>` which makes
    // every run uniquely-branched even if a prior run on the same
    // subtask failed and left its worktree+branch behind.
    const runId = nextRunId(backlogDir);
    const executionMode = workItem.execution_defaults?.worktree_mode ?? "direct";
    let branch = buildRunBranchName(task.id, task.title, runId);
    let worktreePath: string;
    let allowedDirtyDirectFiles: string[] = [];
    try {
      if (executionMode === "direct") {
        const directBusy = listActiveRuns(backlogDir).some(
          (run) => run.repo === repo.id && run.execution_mode === "direct" && isAgentBusyStatus(run.status),
        ) || started.some((run) => run.worktreePath === repo.path);
        if (directBusy) {
          archiveClaim(backlogDir, claim.id);
          skipped.push({ taskId: task.id, reasons: ["direct_checkout_busy"] });
          continue;
        }

        const direct = await inspectDirectCheckout(repo.path, allowDirtyDirect ? { allowDirty: true } : {});
        if (!direct.ok) {
          archiveClaim(backlogDir, claim.id);
          skipped.push({ taskId: task.id, reasons: [direct.reason] });
          continue;
        }
        branch = direct.branch;
        allowedDirtyDirectFiles = direct.dirtyFiles ?? [];
        worktreePath = repo.path;
      } else {
        worktreePath = await ensureWorktree({
          backlogDir,
          repoId: repo.id,
          repoPath: repo.path,
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
      branch,
      worktreePath,
      claimIds: [claim.id],
      executionMode,
    });
    const gitDir = await detectGitDir(repo.path);
    writeContextFile(gitDir, {
      version: 1,
      claim_id: claim.id,
      updated_at: new Date().toISOString(),
    });
    await writeWorktreeContext(worktreePath, run.id, claim.id);
    addRunArtifact(backlogDir, run.id, { kind: "branch", value: branch });
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
        ? `Working directly in ${repo.path} on ${branch}`
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
    updateSubTaskStatus(backlogDir, task.id, "running");

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
      updateSubTaskStatus(backlogDir, task.id, "blocked");
    }
    void executed;
  }

  return { started, skipped };
}
