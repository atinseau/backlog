import { listActiveClaims } from "@backlog/claims";
import { listActiveRuns, listTasks, listWorkItems } from "@backlog/core";
import type {
  ClaimRecord,
  Run,
  Task,
  WorkItem,
} from "@backlog/schemas";
import { Hono } from "hono";
import { COLUMN_KEYS, type ColumnKey, statusToColumn } from "../lib/columns.js";
import type { ServerWorkspace } from "../workspace-context.js";

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
  active_run: Pick<Run, "id" | "status" | "agent_id" | "started_at"> | null;
  active_claim: ClaimSummary | null;
}

interface WorkItemCard {
  id: string;
  title: string;
  priority: WorkItem["priority"];
  status: WorkItem["status"];
  labels: string[];
  repo_targets: string[];
  tasks: TaskCard[];
  blocked_by_claims: ClaimSummary[];
}

interface BoardResponse {
  generated_at: string;
  workspace: string;
  columns: Record<ColumnKey, WorkItemCard[]>;
  active_claims_count: number;
  active_runs_count: number;
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

function buildBoard(workspace: ServerWorkspace, repoFilter?: string): BoardResponse {
  const workItems = listWorkItems(workspace.backlogDir);
  const tasks = listTasks(workspace.backlogDir);
  const claims = listActiveClaims(workspace.backlogDir);
  const runs = listActiveRuns(workspace.backlogDir);

  const columns: Record<ColumnKey, WorkItemCard[]> = {
    todo: [],
    doing: [],
    review: [],
    done: [],
  };

  for (const workItem of workItems) {
    const column = statusToColumn(workItem.status);
    if (!column) continue;

    const itemTasks = tasks.filter((task) => {
      if (task.work_item_id !== workItem.id) return false;
      if (repoFilter && task.repo !== repoFilter) return false;
      return true;
    });

    const taskCards: TaskCard[] = itemTasks.map((task) => {
      const activeRun = findActiveRun(runs, task.id);
      const claimIds = activeRun?.claim_ids ?? [];
      const activeClaim = findActiveClaimForTask(claims, task, claimIds);
      return {
        id: task.id,
        title: task.title,
        repo: task.repo,
        status: task.status,
        scopes: task.scopes,
        risk: task.risk,
        active_run: activeRun
          ? {
              id: activeRun.id,
              status: activeRun.status,
              agent_id: activeRun.agent_id,
              started_at: activeRun.started_at,
            }
          : null,
        active_claim: activeClaim ? summarizeClaim(activeClaim) : null,
      };
    });

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

    const card: WorkItemCard = {
      id: workItem.id,
      title: workItem.title,
      priority: workItem.priority,
      status: workItem.status,
      labels: workItem.labels,
      repo_targets: workItem.repo_targets,
      tasks: taskCards,
      blocked_by_claims: blockedByClaims,
    };

    columns[column].push(card);
  }

  for (const key of COLUMN_KEYS) {
    columns[key].sort((a, b) => priorityOrder(a.priority) - priorityOrder(b.priority));
  }

  return {
    generated_at: new Date().toISOString(),
    workspace: workspace.root,
    columns,
    active_claims_count: claims.length,
    active_runs_count: runs.length,
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

export function boardRoutes(workspace: ServerWorkspace): Hono {
  const app = new Hono();
  app.get("/board", (c) => {
    const repo = c.req.query("repo");
    return c.json(buildBoard(workspace, repo ?? undefined));
  });
  return app;
}
