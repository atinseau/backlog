import { listActiveClaims } from "@backlog/claims";
import {
  computeSubTaskProgress,
  computeTaskProgress,
  elapsedSeconds,
  estimateSubTask,
  etaIso,
  listAllRuns,
  listActiveRuns,
  listSubTasks,
  listTasks,
} from "@backlog/core";
import type {
  ClaimRecord,
  Run,
  SubTask,
  Task,
} from "@backlog/schemas";
import { Hono } from "hono";
import { COLUMN_KEYS, type ColumnKey, statusToColumn } from "../lib/columns.js";
import type { ServerProject } from "../project-context.js";
import type { AppEnv } from "../project-resolver.js";

interface ClaimSummary {
  id: string;
  topic: string;
  paths: string[];
  expires_at: string;
  blocking: boolean;
  expected_finish_at: string | null;
  agent_id: string | null;
}

interface SubTaskCard {
  id: string;
  title: string;
  repo: string;
  status: SubTask["status"];
  scopes: string[];
  blockers: string[];
  risk: SubTask["risk"];
  priority_score: number;
  active_run: Pick<Run, "id" | "status" | "agent_id" | "started_at" | "execution_mode" | "result"> | null;
  latest_run: Pick<Run, "id" | "status" | "agent_id" | "started_at" | "finished_at" | "execution_mode" | "result"> | null;
  active_claim: ClaimSummary | null;
  estimated_duration_seconds: number;
  estimate_source: "manual" | "auto";
  elapsed_seconds: number | null;
  progress_percent: number;
  progress_source: "agent" | "elapsed" | "status";
  eta: string | null;
}

interface TaskCard {
  id: string;
  title: string;
  priority: Task["priority"];
  status: Task["status"];
  labels: string[];
  repo_targets: string[];
  rank: number | null;
  tasks: SubTaskCard[];
  blocked_by_claims: ClaimSummary[];
  estimated_duration_seconds: number;
  remaining_seconds: number;
  progress_percent: number;
}

interface BoardResponse {
  generated_at: string;
  workspace: string;
  columns: Record<ColumnKey, TaskCard[]>;
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

function findActiveRun(runs: Run[], subtaskId: string): Run | null {
  // Run records carry both `subtask_id` (the executable unit) and
  // `task_id` (the parent work item). The board card's task is a
  // SubTask, so we must match on `subtask_id` — comparing against
  // `task_id` would only ever match the parent and silently leave
  // `active_run` null, which collapses the progress bar to the
  // 50% status fallback while a run is in flight.
  return runs.find((run) => run.subtask_id === subtaskId) ?? null;
}

function summarizeRun(run: Run | null): Pick<Run, "id" | "status" | "agent_id" | "started_at" | "finished_at" | "execution_mode" | "result"> | null {
  if (!run) return null;
  return {
    id: run.id,
    status: run.status,
    agent_id: run.agent_id,
    started_at: run.started_at,
    finished_at: run.finished_at,
    execution_mode: run.execution_mode,
    result: run.result,
  };
}

function findActiveClaimForTask(
  claims: ClaimRecord[],
  task: SubTask,
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

function buildBoard(workspace: ServerProject, filters: BoardFilters): BoardResponse {
  const workItems = listTasks(workspace.backlogDir);
  const tasks = listSubTasks(workspace.backlogDir);
  const claims = listActiveClaims(workspace.backlogDir);
  const runs = listActiveRuns(workspace.backlogDir);
  const latestRunsBySubtask = new Map<string, Run>();
  for (const run of listAllRuns(workspace.backlogDir)) {
    const previous = latestRunsBySubtask.get(run.subtask_id);
    const currentTime = new Date(run.finished_at ?? run.started_at ?? 0).getTime();
    const previousTime = previous ? new Date(previous.finished_at ?? previous.started_at ?? 0).getTime() : -1;
    if (!previous || currentTime >= previousTime) {
      latestRunsBySubtask.set(run.subtask_id, run);
    }
  }

  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const archivedRunsCtx = { tasksById };
  const now = Date.now();

  const columns: Record<ColumnKey, TaskCard[]> = {
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
      if (task.task_id !== workItem.id) return false;
      if (filters.repo && task.repo !== filters.repo) return false;
      return true;
    });

    let cardEstimateSeconds = 0;
    let cardRemainingSeconds = 0;

    const taskCards: SubTaskCard[] = itemTasks.map((task) => {
      const activeRun = findActiveRun(runs, task.id);
      const latestRun = activeRun ?? latestRunsBySubtask.get(task.id) ?? null;
      const claimIds = activeRun?.claim_ids ?? [];
      const activeClaim = findActiveClaimForTask(claims, task, claimIds);
      const estimate = estimateSubTask(workspace.backlogDir, task, archivedRunsCtx);
      const progress = computeSubTaskProgress({
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
        blockers: task.blockers,
        risk: task.risk,
        priority_score: task.priority_score,
        active_run: activeRun
          ? {
              id: activeRun.id,
              status: activeRun.status,
              agent_id: activeRun.agent_id,
              started_at: activeRun.started_at,
              execution_mode: activeRun.execution_mode,
              result: activeRun.result,
            }
          : null,
        latest_run: summarizeRun(latestRun),
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

    const itemProgress = computeTaskProgress({
      taskProgresses: taskCards.map((tc) => ({
        percent: tc.progress_percent,
        estimateSeconds: tc.estimated_duration_seconds,
      })),
    });

    const itemEstimate = workItem.estimated_duration_seconds ?? cardEstimateSeconds;

    const card: TaskCard = {
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

function priorityOrder(priority: Task["priority"]): number {
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
