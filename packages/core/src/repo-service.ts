import fs from "node:fs";
import path from "node:path";
import { listActiveClaims } from "@cockpit-ai/claims";
import { loadConfig, saveConfig } from "@cockpit-ai/config";
import type { RepoConfig } from "@cockpit-ai/schemas";
import { listActiveRuns } from "./run-store.js";
import { readAgentsFile, writeAgentsFile } from "./agents.js";
import { deriveWorkStatusFromTasks } from "./work-service.js";
import { readTasksFile, readWorkItemsFile, writeTasksFile, writeWorkItemsFile } from "./state-files.js";

export interface AddRepoInput {
  id: string;
  path: string;
  defaultBranch: string;
  role?: string;
  enabled?: boolean;
}

export interface UpdateRepoInput {
  id?: string;
  path?: string;
  defaultBranch?: string;
  role?: string;
  clearRole?: boolean;
  enabled?: boolean;
}

function workspaceRootFromCockpitDir(cockpitDir: string): string {
  return path.dirname(cockpitDir);
}

function normalizeRepoPath(cockpitDir: string, repoPath: string): string {
  return path.resolve(workspaceRootFromCockpitDir(cockpitDir), repoPath);
}

function ensureRepoPathExists(repoPath: string): void {
  if (!fs.existsSync(repoPath)) {
    throw new Error(`Configured repo path does not exist: ${repoPath}`);
  }
}

export function listRepos(cockpitDir: string): RepoConfig[] {
  return loadConfig(cockpitDir).repos;
}

export function getRepo(cockpitDir: string, repoId: string): RepoConfig | null {
  return listRepos(cockpitDir).find((repo) => repo.id === repoId) ?? null;
}

export function addRepo(cockpitDir: string, input: AddRepoInput): RepoConfig {
  const config = loadConfig(cockpitDir);
  const normalizedPath = normalizeRepoPath(cockpitDir, input.path);
  ensureRepoPathExists(normalizedPath);

  if (config.repos.some((repo) => repo.id === input.id)) {
    throw new Error(`Repo id already exists: ${input.id}`);
  }
  if (config.repos.some((repo) => repo.path === normalizedPath)) {
    throw new Error(`Repo path already exists in this workspace: ${normalizedPath}`);
  }

  const repo: RepoConfig = {
    id: input.id,
    path: normalizedPath,
    default_branch: input.defaultBranch,
    ...(input.role ? { role: input.role } : {}),
    enabled: input.enabled ?? true,
  };
  config.repos.push(repo);
  saveConfig(cockpitDir, config);
  return repo;
}

export function updateRepo(cockpitDir: string, repoId: string, input: UpdateRepoInput): RepoConfig {
  const config = loadConfig(cockpitDir);
  const repo = config.repos.find((candidate) => candidate.id === repoId);
  if (!repo) {
    throw new Error(`Unknown repo: ${repoId}`);
  }

  const activeClaims = listActiveClaims(cockpitDir).filter((claim) => claim.repo === repoId);
  const activeRuns = listActiveRuns(cockpitDir).filter((run) => run.repo === repoId);
  if ((input.id !== undefined || input.path !== undefined) && (activeClaims.length > 0 || activeRuns.length > 0)) {
    throw new Error(`Cannot change repo identity for ${repoId} while active claims or runs still reference it.`);
  }

  if (input.id !== undefined && input.id !== repoId && config.repos.some((candidate) => candidate.id === input.id)) {
    throw new Error(`Repo id already exists: ${input.id}`);
  }

  let normalizedPath: string | undefined;
  if (input.path !== undefined) {
    normalizedPath = normalizeRepoPath(cockpitDir, input.path);
    ensureRepoPathExists(normalizedPath);
    if (config.repos.some((candidate) => candidate.id !== repoId && candidate.path === normalizedPath)) {
      throw new Error(`Repo path already exists in this workspace: ${normalizedPath}`);
    }
  }

  if (input.id !== undefined) {
    const nextId = input.id;
    const tasksFile = readTasksFile(cockpitDir);
    let tasksChanged = false;
    for (const task of tasksFile.tasks) {
      if (task.repo !== repoId) {
        continue;
      }
      task.repo = nextId;
      task.updated_at = new Date().toISOString();
      tasksChanged = true;
    }
    if (tasksChanged) {
      writeTasksFile(cockpitDir, tasksFile);
    }

    const workItemsFile = readWorkItemsFile(cockpitDir);
    let workItemsChanged = false;
    for (const item of workItemsFile.items) {
      let changed = false;
      if (item.repo_targets.includes(repoId)) {
        item.repo_targets = item.repo_targets.map((candidate) => candidate === repoId ? nextId : candidate);
        changed = true;
      }
      if (item.planning.preferred_lane === repoId) {
        item.planning.preferred_lane = nextId;
        changed = true;
      }
      if (changed) {
        item.updated_at = new Date().toISOString();
        workItemsChanged = true;
      }
    }
    if (workItemsChanged) {
      writeWorkItemsFile(cockpitDir, workItemsFile);
    }

    const agentsFile = readAgentsFile(cockpitDir);
    let agentsChanged = false;
    for (const agent of agentsFile.agents) {
      if (!agent.allowed_repos.includes(repoId)) {
        continue;
      }
      agent.allowed_repos = agent.allowed_repos.map((candidate) => candidate === repoId ? nextId : candidate);
      agentsChanged = true;
    }
    if (agentsChanged) {
      writeAgentsFile(cockpitDir, agentsFile);
    }

    repo.id = input.id;
  }
  if (normalizedPath !== undefined) {
    repo.path = normalizedPath;
  }
  if (input.defaultBranch !== undefined) {
    repo.default_branch = input.defaultBranch;
  }
  if (input.role !== undefined) {
    repo.role = input.role;
  }
  if (input.clearRole) {
    delete repo.role;
  }
  if (input.enabled !== undefined) {
    repo.enabled = input.enabled;
  }

  saveConfig(cockpitDir, config);
  return repo;
}

export function removeRepo(cockpitDir: string, repoId: string, options?: { force?: boolean }): RepoConfig {
  const config = loadConfig(cockpitDir);
  const repoIndex = config.repos.findIndex((candidate) => candidate.id === repoId);
  if (repoIndex < 0) {
    throw new Error(`Unknown repo: ${repoId}`);
  }

  const activeClaims = listActiveClaims(cockpitDir).filter((claim) => claim.repo === repoId);
  if (activeClaims.length > 0) {
    throw new Error(`Cannot remove repo ${repoId} while ${activeClaims.length} active claim(s) still reference it.`);
  }

  const activeRuns = listActiveRuns(cockpitDir).filter((run) => run.repo === repoId);
  if (activeRuns.length > 0) {
    throw new Error(`Cannot remove repo ${repoId} while ${activeRuns.length} active run(s) still reference it.`);
  }

  const tasksFile = readTasksFile(cockpitDir);
  const linkedTasks = tasksFile.tasks.filter((task) => task.repo === repoId);
  const workItemsFile = readWorkItemsFile(cockpitDir);
  const linkedWorkItems = workItemsFile.items.filter((item) => item.repo_targets.includes(repoId) || item.planning.preferred_lane === repoId);
  const agentsFile = readAgentsFile(cockpitDir);
  const linkedAgents = agentsFile.agents.filter((agent) => agent.allowed_repos.includes(repoId));

  if (!options?.force && (linkedTasks.length > 0 || linkedWorkItems.length > 0 || linkedAgents.length > 0)) {
    throw new Error(
      `Repo ${repoId} is still referenced by ${linkedTasks.length} task(s), ${linkedWorkItems.length} work item(s), and ${linkedAgents.length} agent(s). Re-run with --force.`,
    );
  }

  if (options?.force) {
    const removedTaskIds = new Set(linkedTasks.map((task) => task.id));
    if (removedTaskIds.size > 0) {
      tasksFile.tasks = tasksFile.tasks
        .filter((task) => task.repo !== repoId)
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
      writeTasksFile(cockpitDir, tasksFile);
    }

    let workItemsChanged = false;
    const affectedWorkItems = new Set(linkedTasks.map((task) => task.work_item_id));
    for (const item of workItemsFile.items) {
      let changed = false;
      if (item.repo_targets.includes(repoId)) {
        item.repo_targets = item.repo_targets.filter((candidate) => candidate !== repoId);
        changed = true;
      }
      if (item.planning.preferred_lane === repoId) {
        delete item.planning.preferred_lane;
        changed = true;
      }
      if (affectedWorkItems.has(item.id)) {
        item.status = deriveWorkStatusFromTasks(cockpitDir, item.id) ?? "backlog";
        changed = true;
      }
      if (changed) {
        item.updated_at = new Date().toISOString();
        workItemsChanged = true;
      }
    }
    if (workItemsChanged) {
      writeWorkItemsFile(cockpitDir, workItemsFile);
    }

    let agentsChanged = false;
    for (const agent of agentsFile.agents) {
      if (!agent.allowed_repos.includes(repoId)) {
        continue;
      }
      agent.allowed_repos = agent.allowed_repos.filter((candidate) => candidate !== repoId);
      agentsChanged = true;
    }
    if (agentsChanged) {
      writeAgentsFile(cockpitDir, agentsFile);
    }
  }

  const [removed] = config.repos.splice(repoIndex, 1);
  if (!removed) {
    throw new Error(`Unknown repo: ${repoId}`);
  }
  saveConfig(cockpitDir, config);
  return removed;
}
