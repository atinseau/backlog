import type { SubTask, Task, ProjectConfig } from "@backlog/schemas";
import { createSubTask } from "./subtask-service.js";
import { listSubTasks } from "./state-files.js";
import { getTask, updateTaskPlanning, updateTaskStatus } from "./task-service.js";

export interface SplitTaskInput {
  workItemId: string;
  repos: string[];
  mode: "parallel" | "serial";
  scopeByRepo?: Record<string, string[]>;
  risk?: "low" | "medium" | "high";
  force?: boolean;
}

export interface SplitTaskResult {
  workItem: Task;
  createdTasks: SubTask[];
  mode: "parallel" | "serial";
}

function priorityScoreForTask(workItem: Task): number {
  switch (workItem.priority) {
    case "P0":
      return 100;
    case "P1":
      return 80;
    case "P2":
      return 50;
    case "P3":
      return 20;
  }
}

function buildTaskTitle(workItem: Task, repo: string, repos: string[]): string {
  if (repos.length === 1) {
    return workItem.title;
  }
  return `${workItem.title} (${repo})`;
}

export function resolveSplitRepos(config: ProjectConfig, workItem: Task, requestedRepos?: string[]): string[] {
  const repoIds = requestedRepos && requestedRepos.length > 0
    ? requestedRepos
    : workItem.repo_targets.length > 0
      ? workItem.repo_targets
      : workItem.planning.preferred_lane
        ? [workItem.planning.preferred_lane]
        : config.repos.length === 1
          ? [config.repos[0]!.id]
          : [];

  const deduped = Array.from(new Set(repoIds));
  const unknown = deduped.filter((repoId) => !config.repos.some((repo) => repo.id === repoId));
  if (unknown.length > 0) {
    throw new Error(`Unknown repo ids for split: ${unknown.join(", ")}`);
  }
  if (deduped.length === 0) {
    throw new Error("Cannot split task without a target repo. Add repo_targets or pass --repo.");
  }
  return deduped;
}

export interface ProposalTaskInput {
  title: string;
  repo: string;
  scopes: string[];
  risk: "low" | "medium" | "high";
  dependsOnIndices: number[];
}

export interface ApplySplitProposalInput {
  workItemId: string;
  tasks: ProposalTaskInput[];
  force?: boolean;
}

export function applySplitProposal(
  backlogDir: string,
  input: ApplySplitProposalInput,
): SplitTaskResult {
  const workItem = getTask(backlogDir, input.workItemId);
  if (!workItem) {
    throw new Error(`Unknown task: ${input.workItemId}`);
  }
  if (input.tasks.length === 0) {
    throw new Error("Proposal must contain at least one task");
  }

  const existingTasks = listSubTasks(backlogDir).filter((task) => task.task_id === input.workItemId);
  if (existingTasks.length > 0 && !input.force) {
    throw new Error(
      `Task ${input.workItemId} already has ${existingTasks.length} task(s). Pass force=true to append.`,
    );
  }

  const createdTasks: SubTask[] = [];
  const indexToId = new Map<number, string>();

  for (let index = 0; index < input.tasks.length; index++) {
    const proposed = input.tasks[index]!;
    const dependsOn = proposed.dependsOnIndices
      .map((depIndex) => indexToId.get(depIndex))
      .filter((id): id is string => Boolean(id));
    const created = createSubTask(backlogDir, {
      workItemId: input.workItemId,
      title: proposed.title,
      repo: proposed.repo,
      scopes: proposed.scopes,
      dependsOn,
      risk: proposed.risk,
      priorityScore: priorityScoreForTask(workItem),
      completionCriteria: workItem.acceptance_criteria,
      plannerOrigin: "split",
      lane: proposed.repo,
    });
    createdTasks.push(created);
    indexToId.set(index, created.id);
  }

  updateTaskPlanning(backlogDir, input.workItemId, {
    split_status: "done",
    ...(input.tasks[0] ? { preferred_lane: input.tasks[0].repo } : {}),
  });
  updateTaskStatus(backlogDir, input.workItemId, "ready");

  const hasDependencies = createdTasks.some((task) => task.depends_on.length > 0);
  return {
    workItem: getTask(backlogDir, input.workItemId)!,
    createdTasks,
    mode: hasDependencies ? "serial" : "parallel",
  };
}

export function splitTask(backlogDir: string, input: SplitTaskInput): SplitTaskResult {
  const workItem = getTask(backlogDir, input.workItemId);
  if (!workItem) {
    throw new Error(`Unknown task: ${input.workItemId}`);
  }

  const existingTasks = listSubTasks(backlogDir).filter((task) => task.task_id === input.workItemId);
  if (existingTasks.length > 0 && !input.force) {
    throw new Error(`Task ${input.workItemId} already has ${existingTasks.length} task(s). Use --force to append more split tasks.`);
  }

  const createdTasks: SubTask[] = [];
  let previousTaskId: string | undefined;

  for (const repo of input.repos) {
    const created = createSubTask(backlogDir, {
      workItemId: input.workItemId,
      title: buildTaskTitle(workItem, repo, input.repos),
      repo,
      scopes: input.scopeByRepo?.[repo] ?? [],
      dependsOn: input.mode === "serial" && previousTaskId ? [previousTaskId] : [],
      risk: input.risk ?? workItem.planning.risk,
      priorityScore: priorityScoreForTask(workItem),
      completionCriteria: workItem.acceptance_criteria,
      plannerOrigin: "split",
      lane: repo,
    });
    createdTasks.push(created);
    previousTaskId = created.id;
  }

  updateTaskPlanning(backlogDir, input.workItemId, {
    split_status: "done",
    ...(input.repos[0] ? { preferred_lane: input.repos[0] } : {}),
  });
  updateTaskStatus(backlogDir, input.workItemId, "ready");

  return {
    workItem: getTask(backlogDir, input.workItemId)!,
    createdTasks,
    mode: input.mode,
  };
}
