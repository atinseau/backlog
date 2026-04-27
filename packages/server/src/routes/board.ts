import { listActiveClaims } from "@backlog/claims";
import {
  computeTaskProgress,
  computeWorkItemProgress,
  elapsedSeconds,
  estimateTask,
  etaIso,
  listActiveRuns,
  listTasks,
  listWorkItems,
} from "@backlog/core";
import type {
  ClaimRecord,
  Run,
  Task,
  WorkItem,
} from "@backlog/schemas";
import { Hono } from "hono";
import { COLUMN_KEYS, type ColumnKey, statusToColumn } from "../lib/columns.js";
import type { ServerWorkspace } from "../workspace-context.js";
import type { AppEnv } from "../workspace-resolver.js";

interface ClaimSummary {
  id: string;
  topic: string;
  paths: string[];
  expires_at: string;
  blocking: boolean;
  expected_finish_at: string | null;
  agent_id: string | null;
}

interface TaskCard {
  id: string;
  title: string;
  repo: string;
  status: Task["status"];
  scopes: string[];
  risk: Task["risk"];
  priority_score: number;
  active_run: Pick<Run, "id" | "status" | "agent_id" | "started_at"> | null;
  active_claim: ClaimSummary | null;
  estimated_duration_seconds: number;
  estimate_source: "manual" | "auto";
  elapsed_seconds: number | null;
  progress_percent: number;
  progress_source: "agent" | "elapsed" | "status";
  eta: string | null;
}

interface WorkItemCard {
  id: string;
  title: string;
  priority: WorkItem["priority"];
  status: WorkItem["status"];
  labels: string[];
  repo_targets: string[];
  rank: number | null;
  tasks: TaskCard[];
  blocked_by_claims: ClaimSummary[];
  estimated_duration_seconds: number;
  remaining_seconds: number;
  progress_percent: number;
}

interface BoardResponse {
  generated_at: string;
  workspace: string;
  columns: Record<ColumnKey, WorkItemCard[]>;
  active_claims_count: number;
  active_runs_count: number;
  total_estimated_seconds: number;
  total_remaining_seconds: number;
}

function summarizeClaim(claim: ClaimRecord, blocking = false): ClaimSummary {
  return {
    id: claim.id,
    topic: claim.topic,
    paths: claim.paths,
    expires_at: claim.expires_at,
    expected_finish_at: claim.expected_finish_at ?? null,
    agent_id: claim.agent_id ?? null,
    blocking,
  };
}

function findActiveRun(runs: Run[], taskId: string): Run | null {
  return runs.find((run) => run.task_id === taskId) ?? null;
}

function findActiveClaimForTask(
  claims: ClaimRecord[],
  task: Task,
  activeRunClaimIds: string[],
): ClaimRecord | null {
  for (const claim of claims) {
    if (activeRunClaimIds.includes(claim.id) && claim.repo === task.repo) {
      return claim;
    }
  }
  return null;
}

interface BoardFilters {
  repo?: string | undefined;
}

function buildBoard(workspace: ServerWorkspace, filters: BoardFilters): BoardResponse {
  const workItems = listWorkItems(workspace.backlogDir);
  const tasks = listTasks(workspace.backlogDir);
  const claims = listActiveClaims(workspace.backlogDir);
  const runs = listActiveRuns(workspace.backlogDir);

  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const archivedRunsCtx = { tasksById };
  const now = Date.now();

  const columns: Record<ColumnKey, WorkItemCard[]> = {
    todo: [],
    doing: [],
    review: [],
    done: [],
  };

  let totalEstimated = 0;
  let totalRemaining = 0;

  for (const workItem of workItems) {
    const column = statusToColumn(workItem.status);
    if (!column) continue;

    const itemTasks = tasks.filter((task) => {
      if (task.work_item_id !== workItem.id) return false;
      if (filters.repo && task.repo !== filters.repo) return false;
      return true;
    });

    let cardEstimateSeconds = 0;
    let cardRemainingSeconds = 0;

    const taskCards: TaskCard[] = itemTasks.map((task) => {
      const activeRun = findActiveRun(runs, task.id);
      const claimIds = activeRun?.claim_ids ?? [];
      const activeClaim = findActiveClaimForTask(claims, task, claimIds);
      const estimate = estimateTask(workspace.backlogDir, task, archivedRunsCtx);
      const progress = computeTaskProgress({
        task,
        activeRun,
        estimateSeconds: estimate.seconds,
        now,
      });
      const isOpen = task.status !== "completed" && task.status !== "canceled";
      cardEstimateSeconds += isOpen ? estimate.seconds : 0;
      const elapsed = elapsedSeconds(activeRun, now);
      const remainingForTask = isOpen
        ? Math.max(0, estimate.seconds - (elapsed ?? 0))
        : 0;
      cardRemainingSeconds += remainingForTask;
      return {
        id: task.id,
        title: task.title,
        repo: task.repo,
        status: task.status,
        scopes: task.scopes,
        risk: task.risk,
        priority_score: task.priority_score,
        active_run: activeRun
          ? {
              id: activeRun.id,
              status: activeRun.status,
              agent_id: activeRun.agent_id,
              started_at: activeRun.started_at,
            }
          : null,
        active_claim: activeClaim ? summarizeClaim(activeClaim) : null,
        estimated_duration_seconds: estimate.seconds,
        estimate_source: estimate.source,
        elapsed_seconds: progress.elapsed_seconds,
        progress_percent: progress.percent,
        progress_source: progress.source,
        eta: etaIso(activeRun, estimate.seconds),
      };
    });

    taskCards.sort((a, b) => b.priority_score - a.priority_score);

    const blockedByClaims: ClaimSummary[] = claims
      .filter((claim) =>
        itemTasks.some(
          (task) =>
            task.repo === claim.repo &&
            task.status !== "running" &&
            task.scopes.some((scope) => claim.paths.some((p) => scope === p || scope.startsWith(p))),
        ),
      )
      .map((claim) => summarizeClaim(claim, true));

    const itemProgress = computeWorkItemProgress({
      taskProgresses: taskCards.map((tc) => ({
        percent: tc.progress_percent,
        estimateSeconds: tc.estimated_duration_seconds,
      })),
    });

    const itemEstimate = workItem.estimated_duration_seconds ?? cardEstimateSeconds;

    const card: WorkItemCard = {
      id: workItem.id,
      title: workItem.title,
      priority: workItem.priority,
      status: workItem.status,
      labels: workItem.labels,
      repo_targets: workItem.repo_targets,
      rank: workItem.rank ?? null,
      tasks: taskCards,
      blocked_by_claims: blockedByClaims,
      estimated_duration_seconds: itemEstimate,
      remaining_seconds: cardRemainingSeconds,
      progress_percent: itemProgress,
    };

    totalEstimated += itemEstimate;
    totalRemaining += cardRemainingSeconds;

    columns[column].push(card);
  }

  for (const key of COLUMN_KEYS) {
    columns[key].sort((a, b) => {
      const priorityDiff = priorityOrder(a.priority) - priorityOrder(b.priority);
      if (priorityDiff !== 0) return priorityDiff;
      const rankDiff = (b.rank ?? 0) - (a.rank ?? 0);
      if (rankDiff !== 0) return rankDiff;
      return 0;
    });
  }

  return {
    generated_at: new Date().toISOString(),
    workspace: workspace.root,
    columns,
    active_claims_count: claims.length,
    active_runs_count: runs.length,
    total_estimated_seconds: totalEstimated,
    total_remaining_seconds: totalRemaining,
  };
}

function priorityOrder(priority: WorkItem["priority"]): number {
  switch (priority) {
    case "P0":
      return 0;
    case "P1":
      return 1;
    case "P2":
      return 2;
    case "P3":
      return 3;
  }
}

export function boardRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get("/board", (c) => {
    const workspace = c.get("workspace");
    const repo = c.req.query("repo") ?? undefined;
    return c.json(buildBoard(workspace, { repo }));
  });
  return app;
}
