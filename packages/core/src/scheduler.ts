import { listActiveClaims, scopesOverlap } from "@backlog/claims";
import { repoCheckoutPath } from "@backlog/schemas";
import type { SubTask, Task, ProjectConfig } from "@backlog/schemas";
import { compatibleAgentsForTask, rankAgentsForTask } from "./agents.js";
import { isAgentBusyStatus, listActiveRuns } from "./run-store.js";
import { listSubTasks, listTasks } from "./state-files.js";
import { isGitRemoteRepository } from "./worktrees.js";
import { runTargetId, runTargetType, subTaskExecutionTarget, taskExecutionTarget, type ExecutionTarget, type ExecutionTargetType } from "./execution-target.js";

export type DecisionAction = "run" | "wait" | "block" | "skip";

export interface SubTaskDecision {
  taskId: string;
  workItemId: string;
  targetType: ExecutionTargetType;
  repo?: string;
  scopes?: string[];
  action: DecisionAction;
  score: number;
  reasons: string[];
  assignedAgentId?: string;
  candidateAgentIds?: string[];
}

export interface ExecutionPlan {
  generatedAt: string;
  maxAgents: number;
  runnable: SubTaskDecision[];
  waiting: SubTaskDecision[];
  blocked: SubTaskDecision[];
  skipped: SubTaskDecision[];
}

export interface BuildExecutionPlanOptions {
  workItemId?: string;
  taskId?: string;
  maxAgentsOverride?: number;
  allowAgentOversubscribe?: boolean;
}

interface EvaluatedDecision extends SubTaskDecision {
  task?: ExecutionTarget;
  compatibleAgentIds?: string[];
}

function isTerminal(status: SubTask["status"]): boolean {
  return status === "completed" || status === "canceled";
}

// "Already scheduled / in flight" — the planner must skip these.
// `running` is obvious (a run is in progress).
// `review` means a previous run hit awaiting_review and is parked
// for human approval; launching a NEW run on the same sub-task would
// create a duplicate worktree (branch already exists → ensureWorktree
// throws → orphaned claim → activity log floods with claim.changed).
// Until the human clicks ✓ Approve or × Cancel, this sub-task is
// done as far as the scheduler is concerned.
function isAlreadyHandled(status: SubTask["status"]): boolean {
  return status === "running" || status === "review";
}

function taskPriorityWeight(workItem: Task): number {
  switch (workItem.priority) {
    case "P0":
      return 100;
    case "P1":
      return 80;
    case "P2":
      return 50;
    case "P3":
      return 20;
  }
}

function riskWeight(task: ExecutionTarget): number {
  switch (task.risk) {
    case "low":
      return 15;
    case "medium":
      return 0;
    case "high":
      return -25;
  }
}

function blastRadiusWeight(task: ExecutionTarget): number {
  if (task.scopes.length <= 2) {
    return 20;
  }
  if (task.scopes.length <= 5) {
    return 5;
  }
  return -20;
}

function overlapWithClaim(task: ExecutionTarget, repoPath: string, claims: ReturnType<typeof listActiveClaims>) {
  return claims.find((claim) => {
    if (claim.repo !== task.repo && claim.repo_path !== repoPath) {
      return false;
    }
    if (claim.mode === "shared" && task.claim_mode === "shared") {
      return false;
    }
    return claim.paths.some((claimScope) => task.scopes.some((taskScope) => scopesOverlap(claimScope, taskScope)));
  });
}

function dependencyReasons(task: ExecutionTarget, tasksById: Map<string, ExecutionTarget>): string[] {
  // Differentiate between deps that might resolve (waiting_on) and
  // deps that almost certainly won't on their own (dependency_failed).
  // Lets the orchestrator panel show different copy / colors for the
  // two cases — "waiting" deserves patience, "failed dependency"
  // deserves attention.
  const reasons: string[] = [];
  for (const depId of task.depends_on) {
    const dep = tasksById.get(depId);
    if (!dep) {
      reasons.push(`unknown_dependency:${depId}`);
      continue;
    }
    if (dep.status === "completed") continue;
    if (dep.status === "blocked" || dep.status === "canceled") {
      reasons.push(`dependency_failed:${depId}`);
    } else {
      reasons.push(`waiting_on:${depId}`);
    }
  }
  return reasons;
}

function policyReasons(task: ExecutionTarget, config: ProjectConfig): string[] {
  const reasons: string[] = [];
  if (config.autonomy_mode === "observe") {
    reasons.push("autonomy_mode_observe");
  }
  if ((config.autonomy_mode === "assist" || config.autonomy_mode === "delegate") && task.risk === "high") {
    reasons.push("high_risk_requires_higher_autonomy");
  }
  return reasons;
}

function scoreTask(task: ExecutionTarget, workItem: Task): number {
  return (
    taskPriorityWeight(workItem) +
    riskWeight(task) +
    blastRadiusWeight(task) +
    (task.status === "review" ? 15 : 0) +
    (task.status === "waiting" ? 10 : 0) +
    (task.depends_on.length === 0 ? 20 : 0)
  );
}

function compareRunnableOrder(
  left: EvaluatedDecision,
  right: EvaluatedDecision,
  tasksById: Map<string, Task>,
): number {
  const leftTask = left.task ? tasksById.get(left.task.task_id) : undefined;
  const rightTask = right.task ? tasksById.get(right.task.task_id) : undefined;
  if (leftTask && rightTask) {
    const priorityDiff = taskPriorityWeight(rightTask) - taskPriorityWeight(leftTask);
    if (priorityDiff !== 0) return priorityDiff;
    const rankDiff = (rightTask.rank ?? 0) - (leftTask.rank ?? 0);
    if (rankDiff !== 0) return rankDiff;
  }
  const subTaskDiff = (right.task?.priority_score ?? 0) - (left.task?.priority_score ?? 0);
  if (subTaskDiff !== 0) return subTaskDiff;
  return right.score - left.score;
}

export function buildExecutionPlan(
  backlogDir: string,
  config: ProjectConfig,
  options?: BuildExecutionPlanOptions,
): ExecutionPlan {
  const effectiveMaxAgents = Math.max(1, options?.maxAgentsOverride ?? config.max_agents);
  const rawSubTasks = listSubTasks(backlogDir);
  const tasks = rawSubTasks.filter(
    (task) =>
      task.planner.origin !== "implicit" &&
      !task.archived_at &&
      !isTerminal(task.status) &&
      !isAlreadyHandled(task.status),
  ).map(subTaskExecutionTarget);
  const workItems = listTasks(backlogDir).filter((item) => !item.archived_at);
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const workItemsById = new Map(workItems.map((item) => [item.id, item]));
  const claims = listActiveClaims(backlogDir);

  const subTaskCandidates = tasks.filter((task) => {
    if (options?.taskId) {
      return task.id === options.taskId;
    }
    if (options?.workItemId) {
      return task.task_id === options.workItemId;
    }
    return true;
  });
  const hasExplicitSubTasks = new Set(
    rawSubTasks
      .filter((task) => !task.archived_at && task.planner.origin !== "implicit")
      .map((task) => task.task_id),
  );

  const directTaskCandidates: Array<{ task: ExecutionTarget; workItem: Task }> = [];
  const directTaskBlocks: EvaluatedDecision[] = [];
  const activeBusyTargetIds = new Set(
    listActiveRuns(backlogDir)
      .filter((run) => isAgentBusyStatus(run.status))
      .map((run) => `${runTargetType(run)}:${runTargetId(run)}`),
  );
  for (const workItem of workItems) {
    if (options?.taskId) continue;
    if (options?.workItemId && workItem.id !== options.workItemId) continue;
    // `proposed` is agent-invented work that no one has audited. It is never
    // runnable by any path, including an explicit target — this is what stops a
    // create → run → create cycle. Checked first and unconditionally so a later
    // edit to the conditions below cannot reopen it.
    if (workItem.status === "proposed") continue;
    if (!options?.workItemId && workItem.status !== "ready") continue;
    if (options?.workItemId && workItem.status !== "ready" && workItem.status !== "backlog") continue;
    if (hasExplicitSubTasks.has(workItem.id)) continue;
    if (activeBusyTargetIds.has(`task:${workItem.id}`)) continue;
    const repoId =
      workItem.repo_targets[0] ??
      config.repos.find((repo) => repo.enabled)?.id ??
      config.repos[0]?.id;
    if (!repoId) {
      directTaskBlocks.push({
        taskId: workItem.id,
        workItemId: workItem.id,
        targetType: "task",
        action: "block",
        score: -1000,
        reasons: ["no_repository_configured"],
      });
      continue;
    }
    directTaskCandidates.push({
      task: taskExecutionTarget(workItem, repoId),
      workItem,
    });
  }
  const candidates = [
    ...subTaskCandidates.map((task) => ({ task, workItem: workItemsById.get(task.task_id) ?? null })),
    ...directTaskCandidates,
  ];

  // Only count runs that are actually keeping the agent busy. Runs in
  // awaiting_review are parked for human approval and shouldn't gate
  // the next task — the same fix as in rankAgentsForTask, applied at
  // the planner level too. Without this, the second-pass scheduling
  // returned no_agent_capacity even though canAgentRunTask was happy.
  const activeRuns = listActiveRuns(backlogDir).filter((run) => isAgentBusyStatus(run.status));
  const activeRunCounts = new Map<string, number>();
  for (const run of activeRuns) {
    activeRunCounts.set(run.agent_id, (activeRunCounts.get(run.agent_id) ?? 0) + 1);
  }

  const preselected: SubTaskDecision[] = [];
  const deferred: SubTaskDecision[] = [];

  const evaluated: EvaluatedDecision[] = [
    ...directTaskBlocks,
    ...candidates.map(({ task, workItem }) => {
    if (!workItem) {
      return {
        taskId: task.id,
        workItemId: task.task_id,
        targetType: task.target_type ?? "subtask",
        repo: task.repo,
        scopes: task.scopes,
        action: "block" as const,
        score: -1000,
        reasons: ["missing_task"],
      };
    }

    // `proposed` is agent-invented work that no one has audited. This is the
    // single funnel every candidate (subtask-sourced or direct-task-sourced)
    // passes through, so blocking here — first, unconditionally — is what
    // actually stops a proposed task's sub-tasks from being scheduled. Never
    // reachable as "runnable", regardless of dependencies, claims or an
    // explicit target.
    if (workItem.status === "proposed") {
      return {
        taskId: task.id,
        workItemId: task.task_id,
        targetType: task.target_type ?? "subtask",
        repo: task.repo,
        scopes: task.scopes,
        action: "block" as const,
        score: -1000,
        reasons: ["task_proposed_not_runnable"],
      };
    }

    const reasons: string[] = [];
    const dependencyBlocks = dependencyReasons(task, tasksById);
    reasons.push(...dependencyBlocks);

    const policyBlocks = policyReasons(task, config);
    reasons.push(...policyBlocks);

    const repo = config.repos.find((repo) => repo.id === task.repo);
    if (!repo) {
      reasons.push("unknown_repo");
    } else {
      // no-access repos are off-limits for runs — even if an agent
      // could otherwise run the task, the planner refuses to schedule
      // it. read-only is fine here; the executor is what refuses a
      // no-access repository at run time.
      if (repo.access_mode === "no-access") {
        reasons.push("repo_no_access");
      }
      const checkoutPath = repoCheckoutPath(repo);
      if (!checkoutPath && !isGitRemoteRepository(repo)) {
        reasons.push("repository_has_no_local_checkout");
      } else if (checkoutPath) {
        const claimOverlap = overlapWithClaim(task, checkoutPath, claims);
        if (claimOverlap) {
          reasons.push(`scope_conflict_with:${claimOverlap.id}`);
        }
      }
    }

    if (task.blockers.length > 0) {
      reasons.push(...task.blockers.map((blocker) => `task_blocker:${blocker}`));
    }

    const score = scoreTask(task, workItem);
    const rankedAgents = rankAgentsForTask(backlogDir, task);
    const compatibleAgents = rankedAgents.filter((candidate) => candidate.available).map((candidate) => candidate.agent);
    if (compatibleAgents.length === 0) {
      reasons.push("no_compatible_agent");
      // Surface the per-agent rejection reasons so the UI can give a
      // helpful message ("claude-code is at capacity") instead of the
      // generic "no AI agent enabled". Format:
      //   agent_blocked:<agent-id>:<reason>
      // We include up to 3 agents, prioritising executable providers
      // — manual / unsupported_provider noise gets filtered out so
      // the user sees what's actually fixable.
      for (const candidate of rankedAgents.slice(0, 3)) {
        const filtered = candidate.reasons.filter(
          (r) => r !== "compatible" && !r.startsWith("unsupported_provider:") && r !== "preferred_agent",
        );
        for (const r of filtered) {
          reasons.push(`agent_blocked:${candidate.agent.id}:${r}`);
        }
      }
    }

    if (reasons.length === 0) {
      return {
        taskId: task.id,
        workItemId: task.task_id,
        targetType: task.target_type ?? "subtask",
        repo: task.repo,
        scopes: task.scopes,
        action: "run" as const,
        score,
        reasons: ["dependencies_clear", "scope_clear", "policy_clear"],
        compatibleAgentIds: compatibleAgents.map((agent) => agent.id),
        candidateAgentIds: rankedAgents.map((candidate) => candidate.agent.id),
        task,
      };
    }

    // `wait`: the task could still run later — scope conflict will
    // resolve when the other claim finishes; `waiting_on:` deps will
    // resolve when the dependency completes.
    // `block`: the task is stuck on something that won't resolve on
    // its own (`dependency_failed:`, `unknown_dependency:`, agent
    // policy reasons, etc).
    const action: DecisionAction = reasons.some(
      (reason) => reason.startsWith("scope_conflict_with:") || reason.startsWith("waiting_on:"),
    )
      ? "wait"
      : "block";

    return {
      taskId: task.id,
      workItemId: task.task_id,
      targetType: task.target_type ?? "subtask",
      repo: task.repo,
      scopes: task.scopes,
      action,
      score,
      reasons,
      compatibleAgentIds: compatibleAgents.map((agent) => agent.id),
      candidateAgentIds: rankedAgents.map((candidate) => candidate.agent.id),
      task,
    };
  })];

  const initialRunnable = evaluated
    .filter((decision) => decision.action === "run")
    .sort((left, right) => compareRunnableOrder(left, right, workItemsById));

  const reserved: Array<{ taskId: string; repo: string; scopes: string[] }> = [];
  const plannedRunCounts = new Map(activeRunCounts);

  for (const decision of initialRunnable) {
    if (!decision.task || !decision.compatibleAgentIds) {
      deferred.push({
        taskId: decision.taskId,
        workItemId: decision.workItemId,
        targetType: decision.targetType,
        ...(decision.repo ? { repo: decision.repo } : {}),
        ...(decision.scopes ? { scopes: decision.scopes } : {}),
        action: "wait",
        score: decision.score,
        reasons: ["scheduler_missing_task_context"],
        ...(decision.candidateAgentIds ? { candidateAgentIds: decision.candidateAgentIds } : {}),
      });
      continue;
    }
    const task = decision.task;
    const compatibleAgentIds = decision.compatibleAgentIds;

    if (preselected.length >= effectiveMaxAgents) {
      deferred.push({
        taskId: decision.taskId,
        workItemId: decision.workItemId,
        targetType: decision.targetType,
        ...(decision.repo ? { repo: decision.repo } : {}),
        ...(decision.scopes ? { scopes: decision.scopes } : {}),
        action: "wait",
        score: decision.score,
        reasons: ["no_scheduler_capacity"],
        ...(decision.candidateAgentIds ? { candidateAgentIds: decision.candidateAgentIds } : {}),
      });
      continue;
    }

    const scopeConflict = reserved.find((entry) => {
      if (entry.repo !== task.repo) {
        return false;
      }
      if (task.claim_mode === "shared") {
        return false;
      }
      return entry.scopes.some((reservedScope) => task.scopes.some((taskScope) => scopesOverlap(reservedScope, taskScope)));
    });
    if (scopeConflict) {
      deferred.push({
        taskId: decision.taskId,
        workItemId: decision.workItemId,
        targetType: decision.targetType,
        ...(decision.repo ? { repo: decision.repo } : {}),
        ...(decision.scopes ? { scopes: decision.scopes } : {}),
        action: "wait",
        score: decision.score,
        reasons: [`scope_conflict_with_selected:${scopeConflict.taskId}`],
        ...(decision.candidateAgentIds ? { candidateAgentIds: decision.candidateAgentIds } : {}),
      });
      continue;
    }

    const compatibleAgents = compatibleAgentsForTask(backlogDir, task);
    const agent = compatibleAgentIds
      .map((agentId) => ({
        id: agentId,
        activeRuns: plannedRunCounts.get(agentId) ?? 0,
      }))
      .sort((left, right) => left.activeRuns - right.activeRuns)
      .find((candidate) => {
        const configuredMaxConcurrentRuns = compatibleAgents
          .find((agentEntry) => agentEntry.id === candidate.id)?.max_concurrent_runs;
        const maxConcurrentRuns = options?.allowAgentOversubscribe && configuredMaxConcurrentRuns !== undefined
          ? Math.max(configuredMaxConcurrentRuns, effectiveMaxAgents)
          : configuredMaxConcurrentRuns;
        return maxConcurrentRuns !== undefined && candidate.activeRuns < maxConcurrentRuns;
      });

    if (!agent) {
      deferred.push({
        taskId: decision.taskId,
        workItemId: decision.workItemId,
        targetType: decision.targetType,
        ...(decision.repo ? { repo: decision.repo } : {}),
        ...(decision.scopes ? { scopes: decision.scopes } : {}),
        action: "wait",
        score: decision.score,
        reasons: ["no_agent_capacity"],
        ...(decision.candidateAgentIds ? { candidateAgentIds: decision.candidateAgentIds } : {}),
      });
      continue;
    }

    plannedRunCounts.set(agent.id, (plannedRunCounts.get(agent.id) ?? 0) + 1);
    reserved.push({
      taskId: decision.taskId,
      repo: task.repo,
      scopes: task.scopes,
    });
    preselected.push({
      taskId: decision.taskId,
      workItemId: decision.workItemId,
      targetType: decision.targetType,
      ...(decision.repo ? { repo: decision.repo } : {}),
      ...(decision.scopes ? { scopes: decision.scopes } : {}),
      action: "run",
      score: decision.score,
      reasons: decision.reasons,
      assignedAgentId: agent.id,
      ...(decision.candidateAgentIds ? { candidateAgentIds: decision.candidateAgentIds } : {}),
    });
  }

  const runnable = preselected;
  const waiting: SubTaskDecision[] = [
    ...evaluated.filter((decision) => decision.action === "wait").map((decision) => ({
      taskId: decision.taskId,
      workItemId: decision.workItemId,
      targetType: decision.targetType,
      ...(decision.repo ? { repo: decision.repo } : {}),
      ...(decision.scopes ? { scopes: decision.scopes } : {}),
      action: "wait" as const,
      score: decision.score,
      reasons: decision.reasons,
      ...(decision.candidateAgentIds ? { candidateAgentIds: decision.candidateAgentIds } : {}),
    })),
    ...deferred,
  ];
  const blocked: SubTaskDecision[] = evaluated.filter((decision) => decision.action === "block").map((decision) => ({
    taskId: decision.taskId,
    workItemId: decision.workItemId,
    targetType: decision.targetType,
    ...(decision.repo ? { repo: decision.repo } : {}),
    ...(decision.scopes ? { scopes: decision.scopes } : {}),
    action: "block" as const,
    score: decision.score,
    reasons: decision.reasons,
    ...(decision.candidateAgentIds ? { candidateAgentIds: decision.candidateAgentIds } : {}),
  }));
  const skipped: SubTaskDecision[] = evaluated
    .filter((decision) => decision.action === "skip")
    .map((decision) => ({
      taskId: decision.taskId,
      workItemId: decision.workItemId,
      targetType: decision.targetType,
      ...(decision.repo ? { repo: decision.repo } : {}),
      ...(decision.scopes ? { scopes: decision.scopes } : {}),
      action: "skip" as const,
      score: decision.score,
      reasons: decision.reasons,
      ...(decision.candidateAgentIds ? { candidateAgentIds: decision.candidateAgentIds } : {}),
    }));

  return {
    generatedAt: new Date().toISOString(),
    maxAgents: effectiveMaxAgents,
    runnable,
    waiting,
    blocked,
    skipped,
  };
}

export interface WorkExecutionOutline {
  workItem: Task;
  tasks: SubTask[];
  maxSafeParallelism: number;
  recommendedNextTaskId: string | null;
}

export function buildTaskExecutionOutline(backlogDir: string, config: ProjectConfig, workItemId: string): WorkExecutionOutline {
  const workItem = listTasks(backlogDir).find((item) => item.id === workItemId);
  if (!workItem) {
    throw new Error(`Unknown task: ${workItemId}`);
  }
  const tasks = listSubTasks(backlogDir)
    .filter((task) => task.task_id === workItemId)
    .sort((left, right) => left.depends_on.length - right.depends_on.length || left.created_at.localeCompare(right.created_at));
  const plan = buildExecutionPlan(backlogDir, config, { workItemId });
  return {
    workItem,
    tasks,
    maxSafeParallelism: Math.min(config.max_agents, tasks.filter((task) => task.depends_on.length === 0).length || 1),
    recommendedNextTaskId: plan.runnable[0]?.taskId ?? null,
  };
}
