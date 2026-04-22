import { workStatusSchema, type WorkItem, type WorkStatus } from "@cockpit-ai/schemas";
import { makeId } from "./id.js";
import { readTasksFile, readWorkItemsFile, writeTasksFile, writeWorkItemsFile } from "./state-files.js";
import { removeSyncConflictsForWorkItem } from "./sync-conflicts.js";

export interface CreateWorkItemInput {
  title: string;
  description?: string;
  priority?: "P0" | "P1" | "P2" | "P3";
  repoTargets?: string[];
  labels?: string[];
  acceptanceCriteria?: string[];
}

export interface UpdateWorkItemInput {
  title?: string;
  description?: string;
  clearDescription?: boolean;
  priority?: "P0" | "P1" | "P2" | "P3";
  repoTargets?: string[];
  labels?: string[];
  acceptanceCriteria?: string[];
  dependencies?: string[];
  planningRisk?: "low" | "medium" | "high";
  preferredLane?: string;
  clearPreferredLane?: boolean;
  splitStatus?: "pending" | "done";
}

export function createWorkItem(cockpitDir: string, input: CreateWorkItemInput): WorkItem {
  const file = readWorkItemsFile(cockpitDir);
  const now = new Date().toISOString();
  const item: WorkItem = {
    id: makeId("WI"),
    title: input.title,
    ...(input.description ? { description: input.description } : {}),
    source_links: [],
    status: "backlog",
    priority: input.priority ?? "P2",
    labels: input.labels ?? [],
    repo_targets: input.repoTargets ?? [],
    acceptance_criteria: input.acceptanceCriteria ?? [],
    dependencies: [],
    planning: {
      split_status: "pending",
      risk: "medium",
    },
    sync: {
      source_of_truth: "cockpit",
      push_status: false,
      push_comments: false,
    },
    created_at: now,
    updated_at: now,
  };
  file.items.push(item);
  writeWorkItemsFile(cockpitDir, file);
  return item;
}

export function getWorkItem(cockpitDir: string, id: string): WorkItem | null {
  return readWorkItemsFile(cockpitDir).items.find((item) => item.id === id) ?? null;
}

export function updateWorkItem(cockpitDir: string, id: string, input: UpdateWorkItemInput): WorkItem {
  const file = readWorkItemsFile(cockpitDir);
  const item = file.items.find((candidate) => candidate.id === id);
  if (!item) {
    throw new Error(`Unknown work item: ${id}`);
  }

  if (input.title !== undefined) {
    item.title = input.title;
  }
  if (input.description !== undefined) {
    item.description = input.description;
  }
  if (input.clearDescription) {
    delete item.description;
  }
  if (input.priority !== undefined) {
    item.priority = input.priority;
  }
  if (input.repoTargets !== undefined) {
    item.repo_targets = input.repoTargets;
  }
  if (input.labels !== undefined) {
    item.labels = input.labels;
  }
  if (input.acceptanceCriteria !== undefined) {
    item.acceptance_criteria = input.acceptanceCriteria;
  }
  if (input.dependencies !== undefined) {
    item.dependencies = input.dependencies;
  }
  if (input.planningRisk !== undefined) {
    item.planning.risk = input.planningRisk;
  }
  if (input.preferredLane !== undefined) {
    item.planning.preferred_lane = input.preferredLane;
  }
  if (input.clearPreferredLane) {
    delete item.planning.preferred_lane;
  }
  if (input.splitStatus !== undefined) {
    item.planning.split_status = input.splitStatus;
  }

  item.updated_at = new Date().toISOString();
  writeWorkItemsFile(cockpitDir, file);
  return item;
}

export function updateWorkItemStatus(cockpitDir: string, id: string, status: WorkStatus): WorkItem {
  const parsedStatus = workStatusSchema.parse(status);
  const file = readWorkItemsFile(cockpitDir);
  const item = file.items.find((candidate) => candidate.id === id);
  if (!item) {
    throw new Error(`Unknown work item: ${id}`);
  }
  item.status = parsedStatus;
  item.updated_at = new Date().toISOString();
  writeWorkItemsFile(cockpitDir, file);
  return item;
}

export function updateWorkItemPlanning(
  cockpitDir: string,
  id: string,
  planning: Partial<WorkItem["planning"]>,
): WorkItem {
  const file = readWorkItemsFile(cockpitDir);
  const item = file.items.find((candidate) => candidate.id === id);
  if (!item) {
    throw new Error(`Unknown work item: ${id}`);
  }
  item.planning = {
    ...item.planning,
    ...planning,
  };
  item.updated_at = new Date().toISOString();
  writeWorkItemsFile(cockpitDir, file);
  return item;
}

export function workItemsSummary(cockpitDir: string): Record<WorkStatus, number> {
  const summary = {
    backlog: 0,
    ready: 0,
    in_progress: 0,
    review: 0,
    test: 0,
    released: 0,
    done: 0,
    blocked: 0,
  } satisfies Record<WorkStatus, number>;

  for (const item of readWorkItemsFile(cockpitDir).items) {
    summary[item.status] += 1;
  }
  return summary;
}

export function deriveWorkStatusFromTasks(cockpitDir: string, workItemId: string): WorkStatus | null {
  const tasks = readTasksFile(cockpitDir).tasks.filter((task) => task.work_item_id === workItemId);
  if (tasks.length === 0) {
    return null;
  }
  if (tasks.some((task) => task.status === "running" || task.status === "planned")) {
    return "in_progress";
  }
  if (tasks.some((task) => task.status === "review")) {
    return "review";
  }
  if (tasks.every((task) => task.status === "completed")) {
    return "done";
  }
  if (tasks.every((task) => task.status === "blocked" || task.status === "waiting")) {
    return "blocked";
  }
  if (tasks.some((task) => task.status === "waiting")) {
    return "ready";
  }
  if (tasks.some((task) => task.status === "queued")) {
    return "ready";
  }
  return null;
}

export function removeWorkItem(cockpitDir: string, id: string, options?: { cascadeTasks?: boolean }): WorkItem {
  const workFile = readWorkItemsFile(cockpitDir);
  const itemIndex = workFile.items.findIndex((candidate) => candidate.id === id);
  if (itemIndex < 0) {
    throw new Error(`Unknown work item: ${id}`);
  }

  const taskFile = readTasksFile(cockpitDir);
  const linkedTasks = taskFile.tasks.filter((task) => task.work_item_id === id);
  if (linkedTasks.length > 0 && !options?.cascadeTasks) {
    throw new Error(`Work item ${id} still has ${linkedTasks.length} task(s). Re-run with --cascade.`);
  }

  if (linkedTasks.length > 0) {
    const removedTaskIds = new Set(linkedTasks.map((task) => task.id));
    taskFile.tasks = taskFile.tasks
      .filter((task) => task.work_item_id !== id)
      .map((task) => {
        const nextDependsOn = task.depends_on.filter((dependencyId) => !removedTaskIds.has(dependencyId));
        if (nextDependsOn.length === task.depends_on.length) {
          return task;
        }
        return {
          ...task,
          depends_on: nextDependsOn,
          updated_at: new Date().toISOString(),
        };
      });
    writeTasksFile(cockpitDir, taskFile);
  }

  const [removed] = workFile.items.splice(itemIndex, 1);
  if (!removed) {
    throw new Error(`Unknown work item: ${id}`);
  }
  writeWorkItemsFile(cockpitDir, workFile);
  removeSyncConflictsForWorkItem(cockpitDir, id);
  return removed;
}
