import { listActiveClaims } from "@backlog/claims";
import {
  computeSubTaskProgress,
  computeTaskProgress,
  elapsedSeconds,
  estimateSubTask,
  etaIso,
  listAllRuns,
  listActiveRuns,
  listRepos,
  listSubTasks,
  listTasks,
  runSubTaskId,
  runTargetType,
  taskExecutionTarget,
} from "@backlog/core";
import { emptyGitWorkingTreeStatus, getWorkingTreeStatus, type GitWorkingTreeStatus } from "@backlog/git";
import { repoCheckoutPath } from "@backlog/schemas";
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
  estimate_source: "manual" | "auto" | "fallback";
  elapsed_seconds: number | null;
  progress_percent: number;
  progress_source: "agent" | "elapsed" | "status";
  eta: string | null;
  implicit: boolean;
}

interface TaskCard {
  id: string;
  title: string;
  description?: string;
  priority: Task["priority"];
  status: Task["status"];
  labels: string[];
  repo_targets: string[];
  rank: number | null;
  created_at: string;
  updated_at: string;
  tasks: SubTaskCard[];
  blocked_by_claims: ClaimSummary[];
  estimated_duration_seconds: number;
  estimate_source: "manual" | "auto" | "fallback";
  remaining_seconds: number;
  progress_percent: number;
}

interface BoardResponse {
  generated_at: string;
  project: string;
  repo_git_statuses: Record<string, GitWorkingTreeStatus & { error?: string }>;
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
  return runs.find((run) => runSubTaskId(run) === subtaskId) ?? null;
}

function directTargetStatus(parentTask: Task, latestRun: Run, activeRun: Run | null): SubTask["status"] {
  if (activeRun && (activeRun.status === "queued" || activeRun.status === "preparing" || activeRun.status === "running")) {
    return "running";
  }
  if (latestRun.status === "awaiting_review" || parentTask.status === "review" || parentTask.status === "test") {
    return "review";
  }
  if (latestRun.status === "succeeded" || parentTask.status === "done" || parentTask.status === "released") {
    return "completed";
  }
  if (latestRun.status === "failed" || latestRun.status === "blocked" || parentTask.status === "blocked") {
    return "blocked";
  }
  return "queued";
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

async function buildRepoGitStatuses(project: ServerProject): Promise<Record<string, GitWorkingTreeStatus & { error?: string }>> {
  const repos = listRepos(project.backlogDir);
  const entries = await Promise.all(
    repos.map(async (repo) => {
      const checkoutPath = repoCheckoutPath(repo);
      if (!checkoutPath) {
        return [repo.id, { ...emptyGitWorkingTreeStatus(), clean: true, error: "remote_repository_no_local_checkout" }] as const;
      }
      try {
        return [repo.id, await getWorkingTreeStatus(checkoutPath)] as const;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return [repo.id, { ...emptyGitWorkingTreeStatus(), clean: false, error: message }] as const;
      }
    }),
  );
  return Object.fromEntries(entries);
}

async function buildBoard(project: ServerProject, filters: BoardFilters): Promise<BoardResponse> {
  const parentTasks = listTasks(project.backlogDir).filter((task) => !task.archived_at);
  const tasks = listSubTasks(project.backlogDir).filter((task) => !task.archived_at);
  const claims = listActiveClaims(project.backlogDir);
  const runs = listActiveRuns(project.backlogDir);
  const repoGitStatuses = await buildRepoGitStatuses(project);
  const allRuns = listAllRuns(project.backlogDir);
  const latestRunsBySubtask = new Map<string, Run>();
  const latestRunsByTask = new Map<string, Run>();
  for (const run of allRuns) {
    const targetType = runTargetType(run);
    const targetId = targetType === "subtask" ? runSubTaskId(run) : run.task_id;
    if (!targetId) continue;
    const targetMap = targetType === "task" ? latestRunsByTask : latestRunsBySubtask;
    const previous = targetMap.get(targetId);
    const currentTime = new Date(run.finished_at ?? run.started_at ?? 0).getTime();
    const previousTime = previous ? new Date(previous.finished_at ?? previous.started_at ?? 0).getTime() : -1;
    if (!previous || currentTime >= previousTime) {
      targetMap.set(targetId, run);
    }
  }
  const activeRunsByTask = new Map(
    runs
      .filter((run) => runTargetType(run) === "task")
      .map((run) => [run.task_id, run] as const),
  );

  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const archivedRunsCtx = { tasksById };
  const now = Date.now();

  const columns: Record<ColumnKey, TaskCard[]> = {
    backlog: [],
    todo: [],
    doing: [],
    review: [],
    done: [],
  };

  let totalEstimated = 0;
  let totalRemaining = 0;

  for (const parentTask of parentTasks) {
    const column = statusToColumn(parentTask.status);
    if (!column) continue;

    const itemTasks = tasks.filter((task) => {
      if (task.task_id !== parentTask.id) return false;
      if (task.planner.origin === "implicit") return false;
      if (filters.repo && task.repo !== filters.repo) return false;
      return true;
    });

    let cardEstimateSeconds = 0;
    let cardRemainingSeconds = 0;
    let cardEstimateSource: "manual" | "auto" | "fallback" = parentTask.estimated_duration_seconds ? "manual" : "fallback";

    const taskCards: SubTaskCard[] = itemTasks.map((task) => {
      const activeRun = findActiveRun(runs, task.id);
      const latestRun = activeRun ?? latestRunsBySubtask.get(task.id) ?? null;
      const claimIds = activeRun?.claim_ids ?? [];
      const activeClaim = findActiveClaimForTask(claims, task, claimIds);
      const estimate = estimateSubTask(project.backlogDir, task, archivedRunsCtx);
      const progress = computeSubTaskProgress({
        task,
        activeRun,
        estimateSeconds: estimate.seconds,
        now,
      });
      const isOpen = task.status !== "completed" && task.status !== "canceled";
      cardEstimateSource = mergeEstimateSource(cardEstimateSource, estimate.source);
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
        implicit: task.planner.origin === "implicit",
      };
    });

    if (itemTasks.length === 0) {
      const directRun = activeRunsByTask.get(parentTask.id) ?? latestRunsByTask.get(parentTask.id) ?? null;
      if (directRun) {
        const activeRun = activeRunsByTask.get(parentTask.id) ?? null;
        const target = {
          ...taskExecutionTarget(parentTask, directRun.repo),
          status: directTargetStatus(parentTask, directRun, activeRun),
        };
        const claimIds = activeRun?.claim_ids ?? [];
        const activeClaim = findActiveClaimForTask(claims, target, claimIds);
        const estimateSource: "manual" | "auto" | "fallback" = parentTask.estimated_duration_seconds ? "manual" : "fallback";
        const estimateSeconds = parentTask.estimated_duration_seconds ?? 900;
        cardEstimateSource = mergeEstimateSource(cardEstimateSource, estimateSource);
        const progress = computeSubTaskProgress({
          task: target,
          activeRun,
          estimateSeconds,
          now,
        });
        const isOpen = parentTask.status !== "done" && parentTask.status !== "released";
        cardEstimateSeconds += isOpen ? estimateSeconds : 0;
        const elapsed = elapsedSeconds(activeRun, now);
        cardRemainingSeconds += isOpen ? Math.max(0, estimateSeconds - (elapsed ?? 0)) : 0;
        taskCards.push({
          id: parentTask.id,
          title: parentTask.title,
          repo: directRun.repo,
          status: target.status,
          scopes: target.scopes,
          blockers: target.blockers,
          risk: target.risk,
          priority_score: target.priority_score,
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
          latest_run: summarizeRun(directRun),
          active_claim: activeClaim ? summarizeClaim(activeClaim) : null,
          estimated_duration_seconds: estimateSeconds,
          estimate_source: estimateSource,
          elapsed_seconds: progress.elapsed_seconds,
          progress_percent: progress.percent,
          progress_source: progress.source,
          eta: etaIso(activeRun, estimateSeconds),
          implicit: true,
        });
      }
    }

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

    const itemEstimate = parentTask.estimated_duration_seconds ?? cardEstimateSeconds;

    const card: TaskCard = {
      id: parentTask.id,
      title: parentTask.title,
      ...(parentTask.description ? { description: parentTask.description } : {}),
      priority: parentTask.priority,
      status: parentTask.status,
      labels: parentTask.labels,
      repo_targets: parentTask.repo_targets,
      rank: parentTask.rank ?? null,
      created_at: parentTask.created_at,
      updated_at: parentTask.updated_at,
      tasks: taskCards,
      blocked_by_claims: blockedByClaims,
      estimated_duration_seconds: itemEstimate,
      estimate_source: cardEstimateSource,
      remaining_seconds: cardRemainingSeconds,
      progress_percent: itemProgress,
    };

    totalEstimated += itemEstimate;
    totalRemaining += cardRemainingSeconds;

    columns[column].push(card);
  }

  for (const key of COLUMN_KEYS) {
    columns[key].sort((a, b) => {
      const rankDiff = (b.rank ?? 0) - (a.rank ?? 0);
      if (rankDiff !== 0) return rankDiff;
      const createdDiff = Date.parse(b.created_at) - Date.parse(a.created_at);
      if (createdDiff !== 0) return createdDiff;
      const priorityDiff = priorityOrder(a.priority) - priorityOrder(b.priority);
      if (priorityDiff !== 0) return priorityDiff;
      return b.id.localeCompare(a.id);
    });
  }

  return {
    generated_at: new Date().toISOString(),
    project: project.root,
    repo_git_statuses: repoGitStatuses,
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

function mergeEstimateSource(
  current: "manual" | "auto" | "fallback",
  next: "manual" | "auto" | "fallback",
): "manual" | "auto" | "fallback" {
  if (current === "manual" || next === "manual") return "manual";
  if (current === "auto" || next === "auto") return "auto";
  return "fallback";
}

export function boardRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get("/board", async (c) => {
    const project = c.get("project");
    const repo = c.req.query("repository") ?? c.req.query("repo") ?? undefined;
    return c.json(await buildBoard(project, { repo }));
  });
  return app;
}
