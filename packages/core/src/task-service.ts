import { taskStatusSchema, type Task, type TaskStatus } from "@backlog/schemas";
import { makeId } from "./id.js";
import { readSubTasksFile, readTasksFile, writeSubTasksFile, writeTasksFile } from "./state-files.js";
import { removeSyncConflictsForTask } from "./sync-conflicts.js";

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

export function createTask(backlogDir: string, input: CreateWorkItemInput): Task {
  const file = readTasksFile(backlogDir);
  const now = new Date().toISOString();
  const item: Task = {
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
      source_of_truth: "backlog",
      push_status: false,
      push_comments: false,
    },
    created_at: now,
    updated_at: now,
  };
  file.tasks.push(item);
  writeTasksFile(backlogDir, file);
  return item;
}

export function getTask(backlogDir: string, id: string): Task | null {
  return readTasksFile(backlogDir).tasks.find((item) => item.id === id) ?? null;
}

export function updateTask(backlogDir: string, id: string, input: UpdateWorkItemInput): Task {
  const file = readTasksFile(backlogDir);
  const item = file.tasks.find((candidate) => candidate.id === id);
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
  writeTasksFile(backlogDir, file);
  return item;
}

export function updateTaskStatus(backlogDir: string, id: string, status: TaskStatus): Task {
  const parsedStatus = taskStatusSchema.parse(status);
  const file = readTasksFile(backlogDir);
  const item = file.tasks.find((candidate) => candidate.id === id);
  if (!item) {
    throw new Error(`Unknown work item: ${id}`);
  }
  item.status = parsedStatus;
  item.updated_at = new Date().toISOString();
  writeTasksFile(backlogDir, file);
  return item;
}

export function updateTaskPlanning(
  backlogDir: string,
  id: string,
  planning: Partial<Task["planning"]>,
): Task {
  const file = readTasksFile(backlogDir);
  const item = file.tasks.find((candidate) => candidate.id === id);
  if (!item) {
    throw new Error(`Unknown work item: ${id}`);
  }
  item.planning = {
    ...item.planning,
    ...planning,
  };
  item.updated_at = new Date().toISOString();
  writeTasksFile(backlogDir, file);
  return item;
}

export function setTaskEstimate(backlogDir: string, id: string, seconds: number | null): Task {
  const file = readTasksFile(backlogDir);
  const item = file.tasks.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`Unknown work item: ${id}`);
  if (seconds === null) {
    delete item.estimated_duration_seconds;
  } else {
    if (!Number.isInteger(seconds) || seconds <= 0) {
      throw new Error("estimate must be a positive integer (seconds)");
    }
    item.estimated_duration_seconds = seconds;
  }
  item.updated_at = new Date().toISOString();
  writeTasksFile(backlogDir, file);
  return item;
}

export interface ReorderWorkItemInput {
  workItemId: string;
  beforeId?: string;
  afterId?: string;
}

export function reorderTask(backlogDir: string, input: ReorderWorkItemInput): Task {
  const file = readTasksFile(backlogDir);
  const item = file.tasks.find((candidate) => candidate.id === input.workItemId);
  if (!item) throw new Error(`Unknown work item: ${input.workItemId}`);

  const samePriority = file.tasks
    .filter((candidate) => candidate.priority === item.priority)
    .sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0));

  const without = samePriority.filter((candidate) => candidate.id !== item.id);

  let insertIndex = without.length;
  if (input.beforeId) {
    const idx = without.findIndex((candidate) => candidate.id === input.beforeId);
    if (idx >= 0) insertIndex = idx;
  } else if (input.afterId) {
    const idx = without.findIndex((candidate) => candidate.id === input.afterId);
    if (idx >= 0) insertIndex = idx + 1;
  } else {
    insertIndex = 0;
  }

  const reordered = [...without.slice(0, insertIndex), item, ...without.slice(insertIndex)];
  const top = 1000;
  const step = 10;
  const now = new Date().toISOString();
  reordered.forEach((entry, idx) => {
    const newRank = top - idx * step;
    if (entry.rank !== newRank) {
      entry.rank = newRank;
      entry.updated_at = now;
    }
  });
  writeTasksFile(backlogDir, file);
  return item;
}

export function tasksSummary(backlogDir: string): Record<TaskStatus, number> {
  const summary = {
    backlog: 0,
    ready: 0,
    in_progress: 0,
    review: 0,
    test: 0,
    released: 0,
    done: 0,
    blocked: 0,
  } satisfies Record<TaskStatus, number>;

  for (const item of readTasksFile(backlogDir).tasks) {
    summary[item.status] += 1;
  }
  return summary;
}

export function deriveTaskStatusFromSubTasks(backlogDir: string, workItemId: string): TaskStatus | null {
  const tasks = readSubTasksFile(backlogDir).subtasks.filter((task) => task.work_item_id === workItemId);
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

export function removeTask(backlogDir: string, id: string, options?: { cascadeTasks?: boolean }): Task {
  const workFile = readTasksFile(backlogDir);
  const itemIndex = workFile.tasks.findIndex((candidate) => candidate.id === id);
  if (itemIndex < 0) {
    throw new Error(`Unknown work item: ${id}`);
  }

  const taskFile = readSubTasksFile(backlogDir);
  const linkedTasks = taskFile.subtasks.filter((task) => task.work_item_id === id);
  if (linkedTasks.length > 0 && !options?.cascadeTasks) {
    throw new Error(`Work item ${id} still has ${linkedTasks.length} task(s). Re-run with --cascade.`);
  }

  if (linkedTasks.length > 0) {
    const removedTaskIds = new Set(linkedTasks.map((task) => task.id));
    taskFile.subtasks = taskFile.subtasks
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
    writeSubTasksFile(backlogDir, taskFile);
  }

  const [removed] = workFile.tasks.splice(itemIndex, 1);
  if (!removed) {
    throw new Error(`Unknown work item: ${id}`);
  }
  writeTasksFile(backlogDir, workFile);
  removeSyncConflictsForTask(backlogDir, id);
  return removed;
}
