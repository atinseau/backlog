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
