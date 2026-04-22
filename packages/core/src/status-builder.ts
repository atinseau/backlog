import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { WorkspaceConfig } from "@cockpit-ai/schemas";
import { listActiveClaims } from "@cockpit-ai/claims";
import { listActiveRuns } from "./run-store.js";
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
  activeClaims: number;
  activeRuns: number;
  workItemCount: number;
  workItemCounts: Record<string, number>;
  taskCounts: Record<string, number>;
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

  return {
    workspaceName: config.workspace_name,
    repoCount: config.repos.filter((repo) => repo.enabled).length,
    activeClaims: listActiveClaims(cockpitDir).length,
    activeRuns: listActiveRuns(cockpitDir).length,
    workItemCount: workItems.items?.length ?? 0,
    workItemCounts: workItemsSummary(cockpitDir),
    taskCounts,
  };
}
