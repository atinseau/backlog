import type { SourceLink, TaskProposal } from "@backlog/schemas";
import { taskStatusSchema, type Task, type TaskStatus } from "@backlog/schemas";
import { nextId } from "@backlog/config";
import { readSubTasksFile, readTasksFile, writeSubTasksFile, writeTasksFile } from "./state-files.js";
import { removeSyncConflictsForTask } from "./sync-conflicts.js";

export interface CreateTaskInput {
  title: string;
  description?: string;
  priority?: "P0" | "P1" | "P2" | "P3";
  repoTargets?: string[];
  labels?: string[];
  acceptanceCriteria?: string[];
  sourceLinks?: SourceLink[];
  manualApprovalRequired?: boolean;
  autoCommit?: boolean;
  pushWhenDone?: boolean;
  createPr?: boolean;
  mergePr?: boolean;
  worktreeMode?: "isolated_worktree" | "direct";
  status?: TaskStatus;
  // Default assignee for sub-tasks generated from this task. Single
  // agent / user id, or empty for "auto". Threaded into the auto-shim
  // sub-task in POST /runs.
  preferredAgents?: string[];
  maxSubagents?: number;
}

export interface UpdateTaskInput {
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
  // Default assignee for new sub-tasks produced from this task. Lives
  // under execution_defaults.preferred_agents — written here so the
  // card-menu Assign action can set it via the same patch endpoint
  // as priority. Existing sub-tasks aren't retroactively updated.
  preferredAgents?: string[];
  worktreeMode?: "isolated_worktree" | "direct";
  maxSubagents?: number;
  proposal?: TaskProposal;
}

function clampMaxSubagents(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 5;
  return Math.max(1, Math.min(99, Math.round(value)));
}

export function createTask(backlogDir: string, input: CreateTaskInput): Task {
  const file = readTasksFile(backlogDir);
  const now = new Date().toISOString();
  const item: Task = {
    id: nextId(backlogDir, "task"),
    title: input.title,
    ...(input.description ? { description: input.description } : {}),
    source_links: input.sourceLinks ?? [],
    status: input.status ?? "ready",
    priority: input.priority ?? "P2",
    labels: input.labels ?? [],
    repo_targets: input.repoTargets ?? [],
    acceptance_criteria: input.acceptanceCriteria ?? [],
    dependencies: [],
    planning: {
      split_status: "pending",
      risk: "medium",
    },
    execution_defaults: {
      manual_approval_required: input.manualApprovalRequired ?? false,
      auto_commit: input.autoCommit ?? true,
      push_when_done: input.pushWhenDone ?? true,
      create_pr: input.createPr ?? false,
      merge_pr: input.mergePr ?? false,
      worktree_mode: input.worktreeMode ?? "direct",
      preferred_agents: input.preferredAgents ?? [],
      max_subagents: clampMaxSubagents(input.maxSubagents),
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

export function updateTask(backlogDir: string, id: string, input: UpdateTaskInput): Task {
  const file = readTasksFile(backlogDir);
  const item = file.tasks.find((candidate) => candidate.id === id);
  if (!item) {
    throw new Error(`Unknown task: ${id}`);
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
  if (input.preferredAgents !== undefined) {
    item.execution_defaults = {
      ...item.execution_defaults,
      preferred_agents: input.preferredAgents,
    };
  }
  if (input.worktreeMode !== undefined) {
    item.execution_defaults = {
      ...item.execution_defaults,
      worktree_mode: input.worktreeMode,
    };
  }
  if (input.maxSubagents !== undefined) {
    item.execution_defaults = {
      ...item.execution_defaults,
      max_subagents: clampMaxSubagents(input.maxSubagents),
    };
  }
  if (input.proposal !== undefined) {
    item.proposal = input.proposal;
  }

  item.updated_at = new Date().toISOString();
  writeTasksFile(backlogDir, file);
  return item;
}

// `proposed` is a one-way door (design spec §7): work an agent invented for
// itself leaves it by human review only, and only for `backlog`. The invariant
// lives here because this function is the writer every status *cascade* goes
// through, and guarding those callers instead is whack-a-mole: four of them
// (createSubTask, updateSubTaskStatus's cascade, removeSubTask, applySplitPlan)
// promoted to `ready` unconditionally, and any fifth added later would too.
//
// It is not the only writer, and the door is not sealed. Three call sites
// assign `task.status` directly and bypass this guard today: `repo-service.ts`
// (a `--force` repository detach re-derives the status of every affected task),
// `sync-conflicts.ts` (resolving a conflict in favour of the external value)
// and `source-state.ts` (importing an external status onto a known task). They
// are left unguarded because each needs its own answer rather than this one —
// an external resolution is a human decision and may legitimately win, whereas
// the detach re-derivation almost certainly should not. Treat a `proposed` task
// reached through those paths as unprotected.
//
// A refusal is a no-op plus a warning, not a throw, on purpose. Most callers are
// cascades — deriveTaskStatusFromSubTasks, the run lifecycle — where throwing
// would abort a legitimate subtask or run operation to protect a status that
// simply must not move; the subtask edit is valid, only the promotion is not.
// The refusal is not silent either: it warns, and it returns the unchanged
// record, so a caller that reports "moved to X" reports the real status (the CLI
// `task move` and the API move route both echo the returned task).
function refusesToLeaveProposed(current: TaskStatus, next: TaskStatus): boolean {
  return current === "proposed" && next !== "proposed" && next !== "backlog";
}

export function updateTaskStatus(backlogDir: string, id: string, status: TaskStatus): Task {
  const parsedStatus = taskStatusSchema.parse(status);
  const file = readTasksFile(backlogDir);
  const item = file.tasks.find((candidate) => candidate.id === id);
  if (!item) {
    throw new Error(`Unknown task: ${id}`);
  }
  if (refusesToLeaveProposed(item.status, parsedStatus)) {
    console.warn(
      `[backlog] refused to move ${id} from proposed to ${parsedStatus}: a proposed task is accepted into backlog by review first.`,
    );
    return item;
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
    throw new Error(`Unknown task: ${id}`);
  }
  item.planning = {
    ...item.planning,
    ...planning,
  };
  item.updated_at = new Date().toISOString();
  writeTasksFile(backlogDir, file);
  return item;
}

// Archive: soft-hide a task from the default board / list views without
// touching its status. Unarchive clears the field. Idempotent.
export function archiveTask(backlogDir: string, id: string): Task {
  const file = readTasksFile(backlogDir);
  const item = file.tasks.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`Unknown task: ${id}`);
  if (!item.archived_at) {
    item.archived_at = new Date().toISOString();
    item.updated_at = item.archived_at;
    writeTasksFile(backlogDir, file);
  }
  return item;
}

export function unarchiveTask(backlogDir: string, id: string): Task {
  const file = readTasksFile(backlogDir);
  const item = file.tasks.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`Unknown task: ${id}`);
  if (item.archived_at) {
    delete item.archived_at;
    item.updated_at = new Date().toISOString();
    writeTasksFile(backlogDir, file);
  }
  return item;
}

export function setTaskEstimate(backlogDir: string, id: string, seconds: number | null): Task {
  const file = readTasksFile(backlogDir);
  const item = file.tasks.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`Unknown task: ${id}`);
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

export interface ReorderTaskInput {
  workItemId: string;
  beforeId?: string;
  afterId?: string;
}

export function reorderTask(backlogDir: string, input: ReorderTaskInput): Task {
  const file = readTasksFile(backlogDir);
  const item = file.tasks.find((candidate) => candidate.id === input.workItemId);
  if (!item) throw new Error(`Unknown task: ${input.workItemId}`);

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
    proposed: 0,
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
  const tasks = readSubTasksFile(backlogDir).subtasks.filter((task) => task.task_id === workItemId);
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
    throw new Error(`Unknown task: ${id}`);
  }

  const taskFile = readSubTasksFile(backlogDir);
  const linkedTasks = taskFile.subtasks.filter((task) => task.task_id === id);
  if (linkedTasks.length > 0 && !options?.cascadeTasks) {
    throw new Error(`Task ${id} still has ${linkedTasks.length} subtask(s). Re-run with --cascade.`);
  }

  if (linkedTasks.length > 0) {
    const removedTaskIds = new Set(linkedTasks.map((task) => task.id));
    taskFile.subtasks = taskFile.subtasks
      .filter((task) => task.task_id !== id)
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
    throw new Error(`Unknown task: ${id}`);
  }
  writeTasksFile(backlogDir, workFile);
  removeSyncConflictsForTask(backlogDir, id);
  return removed;
}
