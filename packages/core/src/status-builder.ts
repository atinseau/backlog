import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { ProjectConfig } from "@backlog/schemas";
import { listActiveClaims } from "@backlog/claims";
import { buildExecutionPlan } from "./scheduler.js";
import { listActiveRuns } from "./run-store.js";
import { listPendingSyncConflicts } from "./sync-conflicts.js";
import { listSubTasks, listWorkItems, readSubTasksFile } from "./state-files.js";
import type { SubTask, WorkItem, WorkStatus } from "@backlog/schemas";

type WorkItemsFile = {
  version: number;
  items?: Array<{ status?: string }>;
};

type SubTasksFile = {
  version: number;
  tasks?: Array<{ status?: string }>;
};

export interface WorkspaceStatus {
  projectName: string;
  repoCount: number;
  enabledRepoCount: number;
  disabledRepoCount: number;
  activeClaims: number;
  activeRuns: number;
  workItemCount: number;
  workItemCounts: Record<string, number>;
  taskCounts: Record<string, number>;
  pendingSyncConflicts: number;
  selectedRepoId?: string;
  repoSummaries: RepoStatusSummary[];
  nextActions: Array<{
    taskId: string;
    title: string;
    workItemId: string;
    assignedAgentId?: string;
    reasons: string[];
  }>;
  hotConflicts: string[];
}

export interface RepoStatusSummary {
  id: string;
  enabled: boolean;
  workItemCount: number;
  taskCount: number;
  taskCounts: Record<string, number>;
  activeRuns: number;
  activeClaims: number;
}

function readYamlFile<T>(filePath: string): T {
  const contents = fs.readFileSync(filePath, "utf8");
  return YAML.parse(contents) as T;
}

function summarizeWorkItems(items: WorkItem[]): Record<WorkStatus, number> {
  return items.reduce<Record<WorkStatus, number>>((summary, item) => {
    summary[item.status] += 1;
    return summary;
  }, {
    backlog: 0,
    ready: 0,
    in_progress: 0,
    review: 0,
    test: 0,
    released: 0,
    done: 0,
    blocked: 0,
  });
}

function subTaskCountsForSubTasks(tasks: SubTask[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const task of tasks) {
    const status = task.status ?? "unknown";
    counts[status] = (counts[status] ?? 0) + 1;
  }
  return counts;
}

function workItemTouchesRepo(item: WorkItem, repoId: string, tasksByWorkItem: Map<string, SubTask[]>): boolean {
  if (item.repo_targets.includes(repoId)) {
    return true;
  }
  if (item.planning.preferred_lane === repoId) {
    return true;
  }
  return (tasksByWorkItem.get(item.id) ?? []).some((task) => task.repo === repoId);
}

export function buildWorkspaceStatus(
  root: string,
  backlogDir: string,
  config: ProjectConfig,
  options?: { repoId?: string },
): WorkspaceStatus {
  const workItems = readYamlFile<WorkItemsFile>(path.join(backlogDir, "work-items.yaml"));
  const tasks = readSubTasksFile(backlogDir);
  const plan = buildExecutionPlan(backlogDir, config);
  const allTasks = listSubTasks(backlogDir);
  const allWorkItems = listWorkItems(backlogDir);
  const tasksById = new Map(allTasks.map((task) => [task.id, task]));
  const workItemsById = new Map(allWorkItems.map((item) => [item.id, item]));
  const tasksByWorkItem = new Map<string, SubTask[]>();
  for (const task of allTasks) {
    const existing = tasksByWorkItem.get(task.work_item_id) ?? [];
    existing.push(task);
    tasksByWorkItem.set(task.work_item_id, existing);
  }

  const selectedRepoId = options?.repoId;
  const filteredTasks = selectedRepoId
    ? allTasks.filter((task) => task.repo === selectedRepoId)
    : allTasks;
  const filteredWorkItems = selectedRepoId
    ? allWorkItems.filter((item) => workItemTouchesRepo(item, selectedRepoId, tasksByWorkItem))
    : allWorkItems;
  const filteredPlanRunnable = selectedRepoId
    ? plan.runnable.filter((decision) => tasksById.get(decision.taskId)?.repo === selectedRepoId)
    : plan.runnable;
  const filteredPlanWaiting = selectedRepoId
    ? plan.waiting.filter((decision) => tasksById.get(decision.taskId)?.repo === selectedRepoId)
    : plan.waiting;

  const nextActions = filteredPlanRunnable.slice(0, 3).map((decision) => {
    const task = tasksById.get(decision.taskId);
    return {
      taskId: decision.taskId,
      title: task?.title ?? decision.taskId,
      workItemId: decision.workItemId,
      ...(decision.assignedAgentId ? { assignedAgentId: decision.assignedAgentId } : {}),
      reasons: decision.reasons,
    };
  });

  const activeClaims = listActiveClaims(backlogDir);
  const activeRuns = listActiveRuns(backlogDir);
  const repoSummaries = config.repos
    .filter((repo) => !selectedRepoId || repo.id === selectedRepoId)
    .map((repo) => {
      const repoTasks = allTasks.filter((task) => task.repo === repo.id);
      const repoWorkItems = allWorkItems.filter((item) => workItemTouchesRepo(item, repo.id, tasksByWorkItem));
      return {
        id: repo.id,
        enabled: repo.enabled,
        workItemCount: repoWorkItems.length,
        taskCount: repoTasks.length,
        taskCounts: subTaskCountsForSubTasks(repoTasks),
        activeRuns: activeRuns.filter((run) => run.repo === repo.id).length,
        activeClaims: activeClaims.filter((claim) => claim.repo === repo.id).length,
      };
    });

  const hotConflicts = [
    ...filteredPlanWaiting
      .filter((decision) => decision.reasons.some((reason) => reason.startsWith("scope_conflict_with:") || reason.startsWith("scope_conflict_with_selected:")))
      .slice(0, 3)
      .map((decision) => {
        const task = tasksById.get(decision.taskId);
        return `${decision.taskId}${task ? ` (${task.title})` : ""}: ${decision.reasons.join(", ")}`;
      }),
    ...listPendingSyncConflicts(backlogDir)
      .filter((conflict) => {
        if (!selectedRepoId) {
          return true;
        }
        const workItem = workItemsById.get(conflict.work_item_id);
        return workItem ? workItemTouchesRepo(workItem, selectedRepoId, tasksByWorkItem) : false;
      })
      .slice(0, 3)
      .map((conflict) => {
        const workItem = workItemsById.get(conflict.work_item_id);
        return `${conflict.work_item_id}${workItem ? ` (${workItem.title})` : ""}: external status conflict`;
      }),
  ];

  return {
    projectName: config.project_name,
    repoCount: config.repos.length,
    enabledRepoCount: config.repos.filter((repo) => repo.enabled).length,
    disabledRepoCount: config.repos.filter((repo) => !repo.enabled).length,
    activeClaims: selectedRepoId ? activeClaims.filter((claim) => claim.repo === selectedRepoId).length : activeClaims.length,
    activeRuns: selectedRepoId ? activeRuns.filter((run) => run.repo === selectedRepoId).length : activeRuns.length,
    workItemCount: filteredWorkItems.length ?? workItems.items?.length ?? 0,
    workItemCounts: summarizeWorkItems(filteredWorkItems),
    taskCounts: subTaskCountsForSubTasks(filteredTasks),
    pendingSyncConflicts: listPendingSyncConflicts(backlogDir).filter((conflict) => {
      if (!selectedRepoId) {
        return true;
      }
      const workItem = workItemsById.get(conflict.work_item_id);
      return workItem ? workItemTouchesRepo(workItem, selectedRepoId, tasksByWorkItem) : false;
    }).length,
    ...(selectedRepoId ? { selectedRepoId } : {}),
    repoSummaries,
    nextActions,
    hotConflicts,
  };
}
