import { listActiveClaims, scopesOverlap } from "@backlog/claims";
import type { Task, WorkItem, WorkspaceConfig } from "@backlog/schemas";
import { compatibleAgentsForTask, rankAgentsForTask } from "./agents.js";
import { listActiveRuns } from "./run-store.js";
import { listTasks, listWorkItems } from "./state-files.js";

export type DecisionAction = "run" | "wait" | "block" | "skip";

export interface TaskDecision {
  taskId: string;
  workItemId: string;
  action: DecisionAction;
  score: number;
  reasons: string[];
  assignedAgentId?: string;
  candidateAgentIds?: string[];
}

export interface ExecutionPlan {
  generatedAt: string;
  maxAgents: number;
  runnable: TaskDecision[];
  waiting: TaskDecision[];
  blocked: TaskDecision[];
  skipped: TaskDecision[];
}

interface EvaluatedDecision extends TaskDecision {
  task?: Task;
  compatibleAgentIds?: string[];
}

function isTerminal(status: Task["status"]): boolean {
  return status === "completed" || status === "canceled";
}

function taskPriorityWeight(workItem: WorkItem): number {
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

function riskWeight(task: Task): number {
  switch (task.risk) {
    case "low":
      return 15;
    case "medium":
      return 0;
    case "high":
      return -25;
  }
}

function blastRadiusWeight(task: Task): number {
  if (task.scopes.length <= 2) {
    return 20;
  }
  if (task.scopes.length <= 5) {
    return 5;
  }
  return -20;
}

function overlapWithClaim(task: Task, repoPath: string, claims: ReturnType<typeof listActiveClaims>) {
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

function dependencyReasons(task: Task, tasksById: Map<string, Task>): string[] {
  return task.depends_on
    .filter((dependencyId) => tasksById.get(dependencyId)?.status !== "completed")
    .map((dependencyId) => `blocked_by_dependency:${dependencyId}`);
}

function policyReasons(task: Task, config: WorkspaceConfig): string[] {
  const reasons: string[] = [];
  if (config.autonomy_mode === "observe") {
    reasons.push("autonomy_mode_observe");
  }
  if (config.autonomy_mode === "assist" && task.execution.manual_approval_required) {
    reasons.push("manual_approval_required");
  }
  if ((config.autonomy_mode === "assist" || config.autonomy_mode === "delegate") && task.risk === "high") {
    reasons.push("high_risk_requires_higher_autonomy");
  }
  return reasons;
}

function scoreTask(task: Task, workItem: WorkItem): number {
  return (
    taskPriorityWeight(workItem) +
    riskWeight(task) +
    blastRadiusWeight(task) +
    (task.status === "review" ? 15 : 0) +
    (task.status === "waiting" ? 10 : 0) +
    (task.depends_on.length === 0 ? 20 : 0)
  );
}

export function buildExecutionPlan(
  backlogDir: string,
  config: WorkspaceConfig,
  options?: { workItemId?: string; taskId?: string },
): ExecutionPlan {
  const tasks = listTasks(backlogDir).filter((task) => !isTerminal(task.status));
  const workItems = listWorkItems(backlogDir);
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const workItemsById = new Map(workItems.map((item) => [item.id, item]));
  const claims = listActiveClaims(backlogDir);

  const candidates = tasks.filter((task) => {
    if (options?.taskId) {
      return task.id === options.taskId;
    }
    if (options?.workItemId) {
      return task.work_item_id === options.workItemId;
    }
    return true;
  });

  const activeRuns = listActiveRuns(backlogDir);
  const activeRunCounts = new Map<string, number>();
  for (const run of activeRuns) {
    activeRunCounts.set(run.agent_id, (activeRunCounts.get(run.agent_id) ?? 0) + 1);
  }

  const preselected: TaskDecision[] = [];
  const deferred: TaskDecision[] = [];

  const evaluated: EvaluatedDecision[] = candidates.map((task) => {
    const workItem = workItemsById.get(task.work_item_id);
    if (!workItem) {
      return {
        taskId: task.id,
        workItemId: task.work_item_id,
        action: "block" as const,
        score: -1000,
        reasons: ["missing_work_item"],
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
      const claimOverlap = overlapWithClaim(task, repo.path, claims);
      if (claimOverlap) {
        reasons.push(`scope_conflict_with:${claimOverlap.id}`);
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
    }

    if (reasons.length === 0) {
      return {
        taskId: task.id,
        workItemId: task.work_item_id,
        action: "run" as const,
        score,
        reasons: ["dependencies_clear", "scope_clear", "policy_clear"],
        compatibleAgentIds: compatibleAgents.map((agent) => agent.id),
        candidateAgentIds: rankedAgents.map((candidate) => candidate.agent.id),
        task,
      };
    }

    const action: DecisionAction = reasons.some((reason) => reason.startsWith("scope_conflict_with:") || reason.startsWith("blocked_by_dependency:"))
      ? "wait"
      : "block";

    return {
      taskId: task.id,
      workItemId: task.work_item_id,
      action,
      score,
      reasons,
      compatibleAgentIds: compatibleAgents.map((agent) => agent.id),
      candidateAgentIds: rankedAgents.map((candidate) => candidate.agent.id),
      task,
    };
  });

  const initialRunnable = evaluated
    .filter((decision) => decision.action === "run")
    .sort((left, right) => right.score - left.score);

  const reserved: Array<{ taskId: string; repo: string; scopes: string[] }> = [];
  const plannedRunCounts = new Map(activeRunCounts);

  for (const decision of initialRunnable) {
    if (!decision.task || !decision.compatibleAgentIds) {
      deferred.push({
        taskId: decision.taskId,
        workItemId: decision.workItemId,
        action: "wait",
        score: decision.score,
        reasons: ["scheduler_missing_task_context"],
        ...(decision.candidateAgentIds ? { candidateAgentIds: decision.candidateAgentIds } : {}),
      });
      continue;
    }
    const task = decision.task;
    const compatibleAgentIds = decision.compatibleAgentIds;

    if (preselected.length >= config.max_agents) {
      deferred.push({
        taskId: decision.taskId,
        workItemId: decision.workItemId,
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
        const maxConcurrentRuns = compatibleAgents
          .find((agentEntry) => agentEntry.id === candidate.id)?.max_concurrent_runs;
        return maxConcurrentRuns !== undefined && candidate.activeRuns < maxConcurrentRuns;
      });

    if (!agent) {
      deferred.push({
        taskId: decision.taskId,
        workItemId: decision.workItemId,
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
      action: "run",
      score: decision.score,
      reasons: decision.reasons,
      assignedAgentId: agent.id,
      ...(decision.candidateAgentIds ? { candidateAgentIds: decision.candidateAgentIds } : {}),
    });
  }

  const runnable = preselected;
  const waiting: TaskDecision[] = [
    ...evaluated.filter((decision) => decision.action === "wait").map((decision) => ({
      taskId: decision.taskId,
      workItemId: decision.workItemId,
      action: "wait" as const,
      score: decision.score,
      reasons: decision.reasons,
      ...(decision.candidateAgentIds ? { candidateAgentIds: decision.candidateAgentIds } : {}),
    })),
    ...deferred,
  ];
  const blocked: TaskDecision[] = evaluated.filter((decision) => decision.action === "block").map((decision) => ({
    taskId: decision.taskId,
    workItemId: decision.workItemId,
    action: "block" as const,
    score: decision.score,
    reasons: decision.reasons,
    ...(decision.candidateAgentIds ? { candidateAgentIds: decision.candidateAgentIds } : {}),
  }));
  const skipped: TaskDecision[] = evaluated
    .filter((decision) => decision.action === "skip")
    .map((decision) => ({
      taskId: decision.taskId,
      workItemId: decision.workItemId,
      action: "skip" as const,
      score: decision.score,
      reasons: decision.reasons,
      ...(decision.candidateAgentIds ? { candidateAgentIds: decision.candidateAgentIds } : {}),
    }));

  return {
    generatedAt: new Date().toISOString(),
    maxAgents: config.max_agents,
    runnable,
    waiting,
    blocked,
    skipped,
  };
}

export interface WorkExecutionOutline {
  workItem: WorkItem;
  tasks: Task[];
  maxSafeParallelism: number;
  recommendedNextTaskId: string | null;
}

export function buildWorkExecutionOutline(backlogDir: string, config: WorkspaceConfig, workItemId: string): WorkExecutionOutline {
  const workItem = listWorkItems(backlogDir).find((item) => item.id === workItemId);
  if (!workItem) {
    throw new Error(`Unknown work item: ${workItemId}`);
  }
  const tasks = listTasks(backlogDir)
    .filter((task) => task.work_item_id === workItemId)
    .sort((left, right) => left.depends_on.length - right.depends_on.length || left.created_at.localeCompare(right.created_at));
  const plan = buildExecutionPlan(backlogDir, config, { workItemId });
  return {
    workItem,
    tasks,
    maxSafeParallelism: Math.min(config.max_agents, tasks.filter((task) => task.depends_on.length === 0).length || 1),
    recommendedNextTaskId: plan.runnable[0]?.taskId ?? null,
  };
}
