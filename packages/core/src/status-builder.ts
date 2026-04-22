import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { WorkspaceConfig } from "@cockpit-ai/schemas";
import { listActiveClaims } from "@cockpit-ai/claims";
import { buildExecutionPlan } from "./scheduler.js";
import { listActiveRuns } from "./run-store.js";
import { listPendingSyncConflicts } from "./sync-conflicts.js";
import { listTasks, listWorkItems } from "./state-files.js";
import { workItemsSummary } from "./work-service.js";

type WorkItemsFile = {
  version: number;
  items?: Array<{ status?: string }>;
};

type TasksFile = {
  version: number;
  tasks?: Array<{ status?: string }>;
};

export interface WorkspaceStatus {
  workspaceName: string;
  repoCount: number;
  enabledRepoCount: number;
  disabledRepoCount: number;
  activeClaims: number;
  activeRuns: number;
  workItemCount: number;
  workItemCounts: Record<string, number>;
  taskCounts: Record<string, number>;
  pendingSyncConflicts: number;
  nextActions: Array<{
    taskId: string;
    title: string;
    workItemId: string;
    assignedAgentId?: string;
    reasons: string[];
  }>;
  hotConflicts: string[];
}

function readYamlFile<T>(filePath: string): T {
  const contents = fs.readFileSync(filePath, "utf8");
  return YAML.parse(contents) as T;
}

export function buildWorkspaceStatus(root: string, cockpitDir: string, config: WorkspaceConfig): WorkspaceStatus {
  const workItems = readYamlFile<WorkItemsFile>(path.join(cockpitDir, "work-items.yaml"));
  const tasks = readYamlFile<TasksFile>(path.join(cockpitDir, "tasks.yaml"));
  const taskCounts: Record<string, number> = {};

  for (const task of tasks.tasks ?? []) {
    const status = task.status ?? "unknown";
    taskCounts[status] = (taskCounts[status] ?? 0) + 1;
  }

  const plan = buildExecutionPlan(cockpitDir, config);
  const tasksById = new Map(listTasks(cockpitDir).map((task) => [task.id, task]));
  const workItemsById = new Map(listWorkItems(cockpitDir).map((item) => [item.id, item]));
  const nextActions = plan.runnable.slice(0, 3).map((decision) => {
    const task = tasksById.get(decision.taskId);
    return {
      taskId: decision.taskId,
      title: task?.title ?? decision.taskId,
      workItemId: decision.workItemId,
      ...(decision.assignedAgentId ? { assignedAgentId: decision.assignedAgentId } : {}),
      reasons: decision.reasons,
    };
  });

  const hotConflicts = [
    ...plan.waiting
      .filter((decision) => decision.reasons.some((reason) => reason.startsWith("scope_conflict_with:") || reason.startsWith("scope_conflict_with_selected:")))
      .slice(0, 3)
      .map((decision) => {
        const task = tasksById.get(decision.taskId);
        return `${decision.taskId}${task ? ` (${task.title})` : ""}: ${decision.reasons.join(", ")}`;
      }),
    ...listPendingSyncConflicts(cockpitDir)
      .slice(0, 3)
      .map((conflict) => {
        const workItem = workItemsById.get(conflict.work_item_id);
        return `${conflict.work_item_id}${workItem ? ` (${workItem.title})` : ""}: external status conflict`;
      }),
  ];

  return {
    workspaceName: config.workspace_name,
    repoCount: config.repos.length,
    enabledRepoCount: config.repos.filter((repo) => repo.enabled).length,
    disabledRepoCount: config.repos.filter((repo) => !repo.enabled).length,
    activeClaims: listActiveClaims(cockpitDir).length,
    activeRuns: listActiveRuns(cockpitDir).length,
    workItemCount: workItems.items?.length ?? 0,
    workItemCounts: workItemsSummary(cockpitDir),
    taskCounts,
    pendingSyncConflicts: listPendingSyncConflicts(cockpitDir).length,
    nextActions,
    hotConflicts,
  };
}
