import fs from "node:fs";
import path from "node:path";
import { listActiveClaims } from "@backlog/claims";
import { loadConfig, saveConfig } from "@backlog/config";
import { cloneRepo, detectGitProvider, repoIdFromGitUrl } from "@backlog/git";
import type { RepoConfig, RepoProvider } from "@backlog/schemas";
import { listActiveRuns } from "./run-store.js";
import { readAgentsFile, writeAgentsFile } from "./agents.js";
import { deriveWorkStatusFromTasks } from "./work-service.js";
import { readSubTasksFile, readWorkItemsFile, writeSubTasksFile, writeWorkItemsFile } from "./state-files.js";

export interface AddRepoInput {
  id: string;
  path: string;
  defaultBranch: string;
  role?: string;
  enabled?: boolean;
  gitUrl?: string;
  provider?: RepoProvider;
}

export interface CloneAndAddRepoInput {
  url: string;
  id?: string;
  destDir?: string;
  defaultBranch?: string;
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
  gitUrl?: string;
  clearGitUrl?: boolean;
  provider?: RepoProvider;
  clearProvider?: boolean;
}

function workspaceRootFromBacklogDir(backlogDir: string): string {
  return path.dirname(backlogDir);
}

function normalizeRepoPath(backlogDir: string, repoPath: string): string {
  return path.resolve(workspaceRootFromBacklogDir(backlogDir), repoPath);
}

function ensureRepoPathExists(repoPath: string): void {
  if (!fs.existsSync(repoPath)) {
    throw new Error(`Configured repo path does not exist: ${repoPath}`);
  }
}

export function listRepos(backlogDir: string): RepoConfig[] {
  return loadConfig(backlogDir).repos;
}

export function getRepo(backlogDir: string, repoId: string): RepoConfig | null {
  return listRepos(backlogDir).find((repo) => repo.id === repoId) ?? null;
}

export function addRepo(backlogDir: string, input: AddRepoInput): RepoConfig {
  const config = loadConfig(backlogDir);
  const normalizedPath = normalizeRepoPath(backlogDir, input.path);
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
    ...(input.gitUrl ? { git_url: input.gitUrl } : {}),
    ...(input.provider ? { provider: input.provider } : {}),
  };
  config.repos.push(repo);
  saveConfig(backlogDir, config);
  return repo;
}

export async function cloneAndAddRepo(
  backlogDir: string,
  input: CloneAndAddRepoInput,
): Promise<RepoConfig> {
  const config = loadConfig(backlogDir);
  const id = input.id ?? repoIdFromGitUrl(input.url);
  if (config.repos.some((repo) => repo.id === id)) {
    throw new Error(`Repo id already exists: ${id}`);
  }
  const projectRoot = workspaceRootFromBacklogDir(backlogDir);
  const destDir = input.destDir
    ? path.resolve(projectRoot, input.destDir)
    : path.resolve(projectRoot, "repos", id);
  if (config.repos.some((repo) => repo.path === destDir)) {
    throw new Error(`Repo path already exists in this workspace: ${destDir}`);
  }

  const cloneOptions: Parameters<typeof cloneRepo>[0] = {
    url: input.url,
    dest: destDir,
  };
  if (input.defaultBranch) cloneOptions.branch = input.defaultBranch;
  await cloneRepo(cloneOptions);

  const provider = detectGitProvider(input.url);
  return addRepo(backlogDir, {
    id,
    path: destDir,
    defaultBranch: input.defaultBranch ?? config.default_branch,
    ...(input.role ? { role: input.role } : {}),
    enabled: input.enabled ?? true,
    gitUrl: input.url,
    provider,
  });
}

export function updateRepo(backlogDir: string, repoId: string, input: UpdateRepoInput): RepoConfig {
  const config = loadConfig(backlogDir);
  const repo = config.repos.find((candidate) => candidate.id === repoId);
  if (!repo) {
    throw new Error(`Unknown repo: ${repoId}`);
  }

  const activeClaims = listActiveClaims(backlogDir).filter((claim) => claim.repo === repoId);
  const activeRuns = listActiveRuns(backlogDir).filter((run) => run.repo === repoId);
  if ((input.id !== undefined || input.path !== undefined) && (activeClaims.length > 0 || activeRuns.length > 0)) {
    throw new Error(`Cannot change repo identity for ${repoId} while active claims or runs still reference it.`);
  }

  if (input.id !== undefined && input.id !== repoId && config.repos.some((candidate) => candidate.id === input.id)) {
    throw new Error(`Repo id already exists: ${input.id}`);
  }

  let normalizedPath: string | undefined;
  if (input.path !== undefined) {
    normalizedPath = normalizeRepoPath(backlogDir, input.path);
    ensureRepoPathExists(normalizedPath);
    if (config.repos.some((candidate) => candidate.id !== repoId && candidate.path === normalizedPath)) {
      throw new Error(`Repo path already exists in this workspace: ${normalizedPath}`);
    }
  }

  if (input.id !== undefined) {
    const nextId = input.id;
    const tasksFile = readSubTasksFile(backlogDir);
    let tasksChanged = false;
    for (const task of tasksFile.subtasks) {
      if (task.repo !== repoId) {
        continue;
      }
      task.repo = nextId;
      task.updated_at = new Date().toISOString();
      tasksChanged = true;
    }
    if (tasksChanged) {
      writeSubTasksFile(backlogDir, tasksFile);
    }

    const workItemsFile = readWorkItemsFile(backlogDir);
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
      writeWorkItemsFile(backlogDir, workItemsFile);
    }

    const agentsFile = readAgentsFile(backlogDir);
    let agentsChanged = false;
    for (const agent of agentsFile.agents) {
      if (!agent.allowed_repos.includes(repoId)) {
        continue;
      }
      agent.allowed_repos = agent.allowed_repos.map((candidate) => candidate === repoId ? nextId : candidate);
      agentsChanged = true;
    }
    if (agentsChanged) {
      writeAgentsFile(backlogDir, agentsFile);
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
  if (input.gitUrl !== undefined) {
    repo.git_url = input.gitUrl;
  }
  if (input.clearGitUrl) {
    delete repo.git_url;
  }
  if (input.provider !== undefined) {
    repo.provider = input.provider;
  }
  if (input.clearProvider) {
    delete repo.provider;
  }

  saveConfig(backlogDir, config);
  return repo;
}

export function removeRepo(backlogDir: string, repoId: string, options?: { force?: boolean }): RepoConfig {
  const config = loadConfig(backlogDir);
  const repoIndex = config.repos.findIndex((candidate) => candidate.id === repoId);
  if (repoIndex < 0) {
    throw new Error(`Unknown repo: ${repoId}`);
  }

  const activeClaims = listActiveClaims(backlogDir).filter((claim) => claim.repo === repoId);
  if (activeClaims.length > 0) {
    throw new Error(`Cannot remove repo ${repoId} while ${activeClaims.length} active claim(s) still reference it.`);
  }

  const activeRuns = listActiveRuns(backlogDir).filter((run) => run.repo === repoId);
  if (activeRuns.length > 0) {
    throw new Error(`Cannot remove repo ${repoId} while ${activeRuns.length} active run(s) still reference it.`);
  }

  const tasksFile = readSubTasksFile(backlogDir);
  const linkedTasks = tasksFile.subtasks.filter((task) => task.repo === repoId);
  const workItemsFile = readWorkItemsFile(backlogDir);
  const linkedWorkItems = workItemsFile.items.filter((item) => item.repo_targets.includes(repoId) || item.planning.preferred_lane === repoId);
  const agentsFile = readAgentsFile(backlogDir);
  const linkedAgents = agentsFile.agents.filter((agent) => agent.allowed_repos.includes(repoId));

  if (!options?.force && (linkedTasks.length > 0 || linkedWorkItems.length > 0 || linkedAgents.length > 0)) {
    throw new Error(
      `Repo ${repoId} is still referenced by ${linkedTasks.length} task(s), ${linkedWorkItems.length} work item(s), and ${linkedAgents.length} agent(s). Re-run with --force.`,
    );
  }

  if (options?.force) {
    const removedTaskIds = new Set(linkedTasks.map((task) => task.id));
    if (removedTaskIds.size > 0) {
      tasksFile.subtasks = tasksFile.subtasks
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
      writeSubTasksFile(backlogDir, tasksFile);
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
        item.status = deriveWorkStatusFromTasks(backlogDir, item.id) ?? "backlog";
        changed = true;
      }
      if (changed) {
        item.updated_at = new Date().toISOString();
        workItemsChanged = true;
      }
    }
    if (workItemsChanged) {
      writeWorkItemsFile(backlogDir, workItemsFile);
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
      writeAgentsFile(backlogDir, agentsFile);
    }
  }

  const [removed] = config.repos.splice(repoIndex, 1);
  if (!removed) {
    throw new Error(`Unknown repo: ${repoId}`);
  }
  saveConfig(backlogDir, config);
  return removed;
}
