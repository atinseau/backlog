import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { ProjectConfig } from "@backlog/schemas";
import { listActiveClaims } from "@backlog/claims";
import { buildExecutionPlan } from "./scheduler.js";
import { listActiveRuns } from "./run-store.js";
import { listPendingSyncConflicts } from "./sync-conflicts.js";
import { listSubTasks, listTasks, readSubTasksFile } from "./state-files.js";
import type { SubTask, Task, TaskStatus } from "@backlog/schemas";

type TasksFile = {
  version: number;
  tasks?: Array<{ status?: string }>;
};

type SubTasksFile = {
  version: number;
  subtasks?: Array<{ status?: string }>;
};

export interface ProjectStatus {
  projectName: string;
  repoCount: number;
  enabledRepoCount: number;
  disabledRepoCount: number;
  activeClaims: number;
  activeRuns: number;
  taskCount: number;
  taskStatusCounts: Record<string, number>;
  subtaskStatusCounts: Record<string, number>;
  pendingSyncConflicts: number;
  selectedRepoId?: string;
  repoSummaries: RepoStatusSummary[];
  nextActions: Array<{
    subtaskId: string;
    title: string;
    parentTaskId: string;
    assignedAgentId?: string;
    reasons: string[];
  }>;
  hotConflicts: string[];
}

/** @deprecated Use ProjectStatus. */
export type WorkspaceStatus = ProjectStatus;

export interface RepoStatusSummary {
  id: string;
  enabled: boolean;
  taskCount: number;
  subtaskCount: number;
  subtaskStatusCounts: Record<string, number>;
  activeRuns: number;
  activeClaims: number;
}

function readYamlFile<T>(filePath: string): T {
  const contents = fs.readFileSync(filePath, "utf8");
  return YAML.parse(contents) as T;
}

function summarizeTasks(items: Task[]): Record<TaskStatus, number> {
  return items.reduce<Record<TaskStatus, number>>((summary, item) => {
    summary[item.status] += 1;
    return summary;
  }, {
    proposed: 0,
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

function taskTouchesRepo(item: Task, repoId: string, subtasksByTask: Map<string, SubTask[]>): boolean {
  if (item.repo_targets.includes(repoId)) {
    return true;
  }
  if (item.planning.preferred_lane === repoId) {
    return true;
  }
  return (subtasksByTask.get(item.id) ?? []).some((task) => task.repo === repoId);
}

export function buildProjectStatus(
  root: string,
  backlogDir: string,
  config: ProjectConfig,
  options?: { repoId?: string },
): ProjectStatus {
  const projectTasksFile = readYamlFile<TasksFile>(path.join(backlogDir, "tasks.yaml"));
  const tasks = readSubTasksFile(backlogDir);
  const plan = buildExecutionPlan(backlogDir, config);
  const allTasks = listSubTasks(backlogDir);
  const allProjectTasks = listTasks(backlogDir);
  const tasksById = new Map(allTasks.map((task) => [task.id, task]));
  const projectTasksById = new Map(allProjectTasks.map((item) => [item.id, item]));
  const subtasksByTask = new Map<string, SubTask[]>();
  for (const task of allTasks) {
    const existing = subtasksByTask.get(task.task_id) ?? [];
    existing.push(task);
    subtasksByTask.set(task.task_id, existing);
  }

  const selectedRepoId = options?.repoId;
  const filteredTasks = selectedRepoId
    ? allTasks.filter((task) => task.repo === selectedRepoId)
    : allTasks;
  const filteredProjectTasks = selectedRepoId
    ? allProjectTasks.filter((item) => taskTouchesRepo(item, selectedRepoId, subtasksByTask))
    : allProjectTasks;
  const filteredPlanRunnable = selectedRepoId
    ? plan.runnable.filter((decision) => tasksById.get(decision.taskId)?.repo === selectedRepoId)
    : plan.runnable;
  const filteredPlanWaiting = selectedRepoId
    ? plan.waiting.filter((decision) => tasksById.get(decision.taskId)?.repo === selectedRepoId)
    : plan.waiting;

  const nextActions = filteredPlanRunnable.slice(0, 3).map((decision) => {
    const task = tasksById.get(decision.taskId);
    return {
      subtaskId: decision.taskId,
      title: task?.title ?? decision.taskId,
      parentTaskId: decision.workItemId,
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
      const repoProjectTasks = allProjectTasks.filter((item) => taskTouchesRepo(item, repo.id, subtasksByTask));
      return {
        id: repo.id,
        enabled: repo.enabled,
        taskCount: repoProjectTasks.length,
        subtaskCount: repoTasks.length,
        subtaskStatusCounts: subTaskCountsForSubTasks(repoTasks),
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
        const task = projectTasksById.get(conflict.task_id);
        return task ? taskTouchesRepo(task, selectedRepoId, subtasksByTask) : false;
      })
      .slice(0, 3)
      .map((conflict) => {
        const task = projectTasksById.get(conflict.task_id);
        return `${conflict.task_id}${task ? ` (${task.title})` : ""}: external status conflict`;
      }),
  ];

  return {
    projectName: config.project_name,
    repoCount: config.repos.length,
    enabledRepoCount: config.repos.filter((repo) => repo.enabled).length,
    disabledRepoCount: config.repos.filter((repo) => !repo.enabled).length,
    activeClaims: selectedRepoId ? activeClaims.filter((claim) => claim.repo === selectedRepoId).length : activeClaims.length,
    activeRuns: selectedRepoId ? activeRuns.filter((run) => run.repo === selectedRepoId).length : activeRuns.length,
    taskCount: filteredProjectTasks.length ?? projectTasksFile.tasks?.length ?? 0,
    taskStatusCounts: summarizeTasks(filteredProjectTasks),
    subtaskStatusCounts: subTaskCountsForSubTasks(filteredTasks),
    pendingSyncConflicts: listPendingSyncConflicts(backlogDir).filter((conflict) => {
      if (!selectedRepoId) {
        return true;
      }
      const task = projectTasksById.get(conflict.task_id);
      return task ? taskTouchesRepo(task, selectedRepoId, subtasksByTask) : false;
    }).length,
    ...(selectedRepoId ? { selectedRepoId } : {}),
    repoSummaries,
    nextActions,
    hotConflicts,
  };
}

/** @deprecated Use buildProjectStatus. */
export const buildWorkspaceStatus = buildProjectStatus;
