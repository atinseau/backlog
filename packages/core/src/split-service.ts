import type { Task, WorkItem, WorkspaceConfig } from "@cockpit-ai/schemas";
import { createTask } from "./task-service.js";
import { listTasks } from "./state-files.js";
import { getWorkItem, updateWorkItemPlanning, updateWorkItemStatus } from "./work-service.js";

export interface SplitWorkItemInput {
  workItemId: string;
  repos: string[];
  mode: "parallel" | "serial";
  scopeByRepo?: Record<string, string[]>;
  risk?: "low" | "medium" | "high";
  force?: boolean;
}

export interface SplitWorkItemResult {
  workItem: WorkItem;
  createdTasks: Task[];
  mode: "parallel" | "serial";
}

function priorityScoreForWorkItem(workItem: WorkItem): number {
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

function buildTaskTitle(workItem: WorkItem, repo: string, repos: string[]): string {
  if (repos.length === 1) {
    return workItem.title;
  }
  return `${workItem.title} (${repo})`;
}

export function resolveSplitRepos(config: WorkspaceConfig, workItem: WorkItem, requestedRepos?: string[]): string[] {
  const repoIds = requestedRepos && requestedRepos.length > 0
    ? requestedRepos
    : workItem.repo_targets.length > 0
      ? workItem.repo_targets
      : workItem.planning.preferred_lane
        ? [workItem.planning.preferred_lane]
        : config.repos.length === 1
          ? [config.repos[0]!.id]
          : [];

  const deduped = Array.from(new Set(repoIds));
  const unknown = deduped.filter((repoId) => !config.repos.some((repo) => repo.id === repoId));
  if (unknown.length > 0) {
    throw new Error(`Unknown repo ids for split: ${unknown.join(", ")}`);
  }
  if (deduped.length === 0) {
    throw new Error("Cannot split work item without a target repo. Add repo_targets or pass --repo.");
  }
  return deduped;
}

export function splitWorkItem(cockpitDir: string, input: SplitWorkItemInput): SplitWorkItemResult {
  const workItem = getWorkItem(cockpitDir, input.workItemId);
  if (!workItem) {
    throw new Error(`Unknown work item: ${input.workItemId}`);
  }

  const existingTasks = listTasks(cockpitDir).filter((task) => task.work_item_id === input.workItemId);
  if (existingTasks.length > 0 && !input.force) {
    throw new Error(`Work item ${input.workItemId} already has ${existingTasks.length} task(s). Use --force to append more split tasks.`);
  }

  const createdTasks: Task[] = [];
  let previousTaskId: string | undefined;

  for (const repo of input.repos) {
    const created = createTask(cockpitDir, {
      workItemId: input.workItemId,
      title: buildTaskTitle(workItem, repo, input.repos),
      repo,
      scopes: input.scopeByRepo?.[repo] ?? [],
      dependsOn: input.mode === "serial" && previousTaskId ? [previousTaskId] : [],
      risk: input.risk ?? workItem.planning.risk,
      priorityScore: priorityScoreForWorkItem(workItem),
      completionCriteria: workItem.acceptance_criteria,
      plannerOrigin: "split",
      lane: repo,
    });
    createdTasks.push(created);
    previousTaskId = created.id;
  }

  updateWorkItemPlanning(cockpitDir, input.workItemId, {
    split_status: "done",
    ...(input.repos[0] ? { preferred_lane: input.repos[0] } : {}),
  });
  updateWorkItemStatus(cockpitDir, input.workItemId, "ready");

  return {
    workItem: getWorkItem(cockpitDir, input.workItemId)!,
    createdTasks,
    mode: input.mode,
  };
}
