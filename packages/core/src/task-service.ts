import {
  taskStatusSchema,
  type Task,
  type TaskStatus,
} from "@cockpit-ai/schemas";
import { makeId } from "./id.js";
import { getWorkItem, updateWorkItemStatus, deriveWorkStatusFromTasks } from "./work-service.js";
import { readTasksFile, writeTasksFile } from "./state-files.js";

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

export function createTask(cockpitDir: string, input: CreateTaskInput): Task {
  const workItem = getWorkItem(cockpitDir, input.workItemId);
  if (!workItem) {
    throw new Error(`Unknown work item: ${input.workItemId}`);
  }

  const file = readTasksFile(cockpitDir);
  const now = new Date().toISOString();
  const task: Task = {
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
  file.tasks.push(task);
  writeTasksFile(cockpitDir, file);
  updateWorkItemStatus(cockpitDir, input.workItemId, "ready");
  return task;
}

export function getTask(cockpitDir: string, id: string): Task | null {
  return readTasksFile(cockpitDir).tasks.find((task) => task.id === id) ?? null;
}

export function updateTask(cockpitDir: string, id: string, input: UpdateTaskInput): Task {
  const file = readTasksFile(cockpitDir);
  const task = file.tasks.find((candidate) => candidate.id === id);
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
  writeTasksFile(cockpitDir, file);
  return task;
}

export function updateTaskStatus(cockpitDir: string, id: string, status: TaskStatus): Task {
  const parsedStatus = taskStatusSchema.parse(status);
  const file = readTasksFile(cockpitDir);
  const task = file.tasks.find((candidate) => candidate.id === id);
  if (!task) {
    throw new Error(`Unknown task: ${id}`);
  }
  task.status = parsedStatus;
  task.updated_at = new Date().toISOString();
  writeTasksFile(cockpitDir, file);

  const derivedWorkStatus = deriveWorkStatusFromTasks(cockpitDir, task.work_item_id);
  if (derivedWorkStatus) {
    updateWorkItemStatus(cockpitDir, task.work_item_id, derivedWorkStatus);
  }

  return task;
}

export function blockTask(cockpitDir: string, id: string, reasons: string[]): Task {
  const task = getTask(cockpitDir, id);
  if (!task) {
    throw new Error(`Unknown task: ${id}`);
  }

  const blockers = Array.from(new Set([...task.blockers, ...reasons]));
  updateTask(cockpitDir, id, { blockers });
  return updateTaskStatus(cockpitDir, id, "blocked");
}

export function unblockTask(cockpitDir: string, id: string, reasons?: string[]): Task {
  const task = getTask(cockpitDir, id);
  if (!task) {
    throw new Error(`Unknown task: ${id}`);
  }

  const blockers = reasons && reasons.length > 0
    ? task.blockers.filter((blocker) => !reasons.includes(blocker))
    : [];

  updateTask(cockpitDir, id, { blockers });
  return updateTaskStatus(cockpitDir, id, blockers.length > 0 ? "blocked" : "planned");
}

export function removeTask(cockpitDir: string, id: string): Task {
  const file = readTasksFile(cockpitDir);
  const index = file.tasks.findIndex((candidate) => candidate.id === id);
  if (index < 0) {
    throw new Error(`Unknown task: ${id}`);
  }

  const [removed] = file.tasks.splice(index, 1);
  if (!removed) {
    throw new Error(`Unknown task: ${id}`);
  }
  for (const task of file.tasks) {
    if (task.depends_on.includes(id)) {
      task.depends_on = task.depends_on.filter((dependencyId) => dependencyId !== id);
      task.updated_at = new Date().toISOString();
    }
  }
  writeTasksFile(cockpitDir, file);

  const derivedWorkStatus = deriveWorkStatusFromTasks(cockpitDir, removed.work_item_id);
  if (derivedWorkStatus) {
    updateWorkItemStatus(cockpitDir, removed.work_item_id, derivedWorkStatus);
  } else {
    updateWorkItemStatus(cockpitDir, removed.work_item_id, "backlog");
  }

  return removed;
}
