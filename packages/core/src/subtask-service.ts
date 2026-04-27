import {
  subTaskStatusSchema,
  type SubTask,
  type SubTaskStatus,
} from "@backlog/schemas";
import { makeId } from "./id.js";
import { getWorkItem, updateWorkItemStatus, deriveWorkStatusFromTasks } from "./work-service.js";
import { readSubTasksFile, writeSubTasksFile } from "./state-files.js";

export interface CreateTaskInput {
  workItemId: string;
  title: string;
  repo: string;
  scopes?: string[];
  dependsOn?: string[];
  blockers?: string[];
  risk?: "low" | "medium" | "high";
  priorityScore?: number;
  claimMode?: "exclusive" | "shared";
  completionCriteria?: string[];
  plannerOrigin?: "manual" | "split" | "imported";
  lane?: string;
  preferredAgents?: string[];
  requiredCapabilities?: string[];
  manualApprovalRequired?: boolean;
}

export interface UpdateTaskInput {
  title?: string;
  repo?: string;
  scopes?: string[];
  dependsOn?: string[];
  blockers?: string[];
  risk?: "low" | "medium" | "high";
  priorityScore?: number;
  claimMode?: "exclusive" | "shared";
  completionCriteria?: string[];
  lane?: string;
  preferredAgents?: string[];
  requiredCapabilities?: string[];
  manualApprovalRequired?: boolean;
  plannerLocked?: boolean;
}

export function createSubTask(backlogDir: string, input: CreateTaskInput): SubTask {
  const workItem = getWorkItem(backlogDir, input.workItemId);
  if (!workItem) {
    throw new Error(`Unknown work item: ${input.workItemId}`);
  }

  const file = readSubTasksFile(backlogDir);
  const now = new Date().toISOString();
  const task: SubTask = {
    id: makeId("TASK"),
    work_item_id: input.workItemId,
    title: input.title,
    repo: input.repo,
    status: "queued",
    priority_score: input.priorityScore ?? 50,
    risk: input.risk ?? "medium",
    scopes: input.scopes ?? [],
    claim_mode: input.claimMode ?? "exclusive",
    depends_on: input.dependsOn ?? [],
    blockers: input.blockers ?? [],
    execution: {
      ...(input.lane ? { lane: input.lane } : {}),
      preferred_agents: input.preferredAgents ?? [],
      required_capabilities: input.requiredCapabilities ?? [],
      manual_approval_required: input.manualApprovalRequired ?? false,
    },
    completion: {
      done_when: input.completionCriteria ?? [],
    },
    planner: {
      origin: input.plannerOrigin ?? "manual",
      locked: false,
      last_planned_at: input.plannerOrigin ? now : undefined,
    },
    created_at: now,
    updated_at: now,
  };
  file.subtasks.push(task);
  writeSubTasksFile(backlogDir, file);
  updateWorkItemStatus(backlogDir, input.workItemId, "ready");
  return task;
}

export function getSubTask(backlogDir: string, id: string): SubTask | null {
  return readSubTasksFile(backlogDir).subtasks.find((task) => task.id === id) ?? null;
}

export function updateTask(backlogDir: string, id: string, input: UpdateTaskInput): SubTask {
  const file = readSubTasksFile(backlogDir);
  const task = file.subtasks.find((candidate) => candidate.id === id);
  if (!task) {
    throw new Error(`Unknown task: ${id}`);
  }

  if (input.title !== undefined) {
    task.title = input.title;
  }
  if (input.repo !== undefined) {
    task.repo = input.repo;
  }
  if (input.scopes !== undefined) {
    task.scopes = input.scopes;
  }
  if (input.dependsOn !== undefined) {
    task.depends_on = input.dependsOn;
  }
  if (input.blockers !== undefined) {
    task.blockers = input.blockers;
  }
  if (input.risk !== undefined) {
    task.risk = input.risk;
  }
  if (input.priorityScore !== undefined) {
    task.priority_score = input.priorityScore;
  }
  if (input.claimMode !== undefined) {
    task.claim_mode = input.claimMode;
  }
  if (input.completionCriteria !== undefined) {
    task.completion.done_when = input.completionCriteria;
  }
  if (input.lane !== undefined) {
    task.execution.lane = input.lane;
  }
  if (input.preferredAgents !== undefined) {
    task.execution.preferred_agents = input.preferredAgents;
  }
  if (input.requiredCapabilities !== undefined) {
    task.execution.required_capabilities = input.requiredCapabilities;
  }
  if (input.manualApprovalRequired !== undefined) {
    task.execution.manual_approval_required = input.manualApprovalRequired;
  }
  if (input.plannerLocked !== undefined) {
    task.planner.locked = input.plannerLocked;
  }

  task.updated_at = new Date().toISOString();
  writeSubTasksFile(backlogDir, file);
  return task;
}

export function updateSubTaskStatus(backlogDir: string, id: string, status: SubTaskStatus): SubTask {
  const parsedStatus = subTaskStatusSchema.parse(status);
  const file = readSubTasksFile(backlogDir);
  const task = file.subtasks.find((candidate) => candidate.id === id);
  if (!task) {
    throw new Error(`Unknown task: ${id}`);
  }
  task.status = parsedStatus;
  task.updated_at = new Date().toISOString();
  writeSubTasksFile(backlogDir, file);

  const derivedWorkStatus = deriveWorkStatusFromTasks(backlogDir, task.work_item_id);
  if (derivedWorkStatus) {
    updateWorkItemStatus(backlogDir, task.work_item_id, derivedWorkStatus);
  }

  return task;
}

export function blockTask(backlogDir: string, id: string, reasons: string[]): SubTask {
  const task = getSubTask(backlogDir, id);
  if (!task) {
    throw new Error(`Unknown task: ${id}`);
  }

  const blockers = Array.from(new Set([...task.blockers, ...reasons]));
  updateTask(backlogDir, id, { blockers });
  return updateSubTaskStatus(backlogDir, id, "blocked");
}

export function unblockTask(backlogDir: string, id: string, reasons?: string[]): SubTask {
  const task = getSubTask(backlogDir, id);
  if (!task) {
    throw new Error(`Unknown task: ${id}`);
  }

  const blockers = reasons && reasons.length > 0
    ? task.blockers.filter((blocker) => !reasons.includes(blocker))
    : [];

  updateTask(backlogDir, id, { blockers });
  return updateSubTaskStatus(backlogDir, id, blockers.length > 0 ? "blocked" : "planned");
}

export function setSubTaskEstimate(
  backlogDir: string,
  id: string,
  seconds: number,
  source: "manual" | "auto" = "manual",
): SubTask {
  if (!Number.isInteger(seconds) || seconds <= 0) {
    throw new Error("estimate must be a positive integer (seconds)");
  }
  const file = readSubTasksFile(backlogDir);
  const task = file.subtasks.find((candidate) => candidate.id === id);
  if (!task) throw new Error(`Unknown task: ${id}`);
  task.estimated_duration_seconds = seconds;
  task.estimate_source = source;
  task.updated_at = new Date().toISOString();
  writeSubTasksFile(backlogDir, file);
  return task;
}

export function clearSubTaskEstimate(backlogDir: string, id: string): SubTask {
  const file = readSubTasksFile(backlogDir);
  const task = file.subtasks.find((candidate) => candidate.id === id);
  if (!task) throw new Error(`Unknown task: ${id}`);
  delete task.estimated_duration_seconds;
  delete task.estimate_source;
  task.updated_at = new Date().toISOString();
  writeSubTasksFile(backlogDir, file);
  return task;
}

export function setSubTaskProgress(backlogDir: string, id: string, percent: number): SubTask {
  if (!Number.isFinite(percent)) throw new Error("progress must be a number");
  const value = Math.min(100, Math.max(0, Math.round(percent)));
  const file = readSubTasksFile(backlogDir);
  const task = file.subtasks.find((candidate) => candidate.id === id);
  if (!task) throw new Error(`Unknown task: ${id}`);
  task.progress_percent = value;
  task.updated_at = new Date().toISOString();
  writeSubTasksFile(backlogDir, file);
  return task;
}

export interface ReorderTaskInput {
  taskId: string;
  beforeId?: string;
  afterId?: string;
}

export function reorderSubTask(backlogDir: string, input: ReorderTaskInput): SubTask {
  const file = readSubTasksFile(backlogDir);
  const task = file.subtasks.find((candidate) => candidate.id === input.taskId);
  if (!task) throw new Error(`Unknown task: ${input.taskId}`);

  const sameWorkItem = file.subtasks
    .filter((candidate) => candidate.work_item_id === task.work_item_id)
    .sort((a, b) => b.priority_score - a.priority_score);

  const without = sameWorkItem.filter((candidate) => candidate.id !== task.id);

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

  const reordered = [...without.slice(0, insertIndex), task, ...without.slice(insertIndex)];
  const top = 1000;
  const step = 10;
  const now = new Date().toISOString();
  reordered.forEach((entry, idx) => {
    const newScore = top - idx * step;
    if (entry.priority_score !== newScore) {
      entry.priority_score = newScore;
      entry.updated_at = now;
    }
  });
  writeSubTasksFile(backlogDir, file);
  return task;
}

export function removeTask(backlogDir: string, id: string): SubTask {
  const file = readSubTasksFile(backlogDir);
  const index = file.subtasks.findIndex((candidate) => candidate.id === id);
  if (index < 0) {
    throw new Error(`Unknown task: ${id}`);
  }

  const [removed] = file.subtasks.splice(index, 1);
  if (!removed) {
    throw new Error(`Unknown task: ${id}`);
  }
  for (const task of file.subtasks) {
    if (task.depends_on.includes(id)) {
      task.depends_on = task.depends_on.filter((dependencyId) => dependencyId !== id);
      task.updated_at = new Date().toISOString();
    }
  }
  writeSubTasksFile(backlogDir, file);

  const derivedWorkStatus = deriveWorkStatusFromTasks(backlogDir, removed.work_item_id);
  if (derivedWorkStatus) {
    updateWorkItemStatus(backlogDir, removed.work_item_id, derivedWorkStatus);
  } else {
    updateWorkItemStatus(backlogDir, removed.work_item_id, "backlog");
  }

  return removed;
}
