import { workStatusSchema, type WorkItem, type WorkStatus } from "@cockpit-ai/schemas";
import { makeId } from "./id.js";
import { readTasksFile, readWorkItemsFile, writeWorkItemsFile } from "./state-files.js";

export interface CreateWorkItemInput {
  title: string;
  description?: string;
  priority?: "P0" | "P1" | "P2" | "P3";
  repoTargets?: string[];
  labels?: string[];
  acceptanceCriteria?: string[];
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
