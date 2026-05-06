import fs from "node:fs";
import path from "node:path";
import { listActiveClaims } from "@backlog/claims";
import { loadConfig, saveConfig } from "@backlog/config";
import { cloneRepo, detectGitProvider, repoIdFromGitUrl } from "@backlog/git";
import { repoCheckoutPath } from "@backlog/schemas";
import type {
  RepoAccessMode,
  RepoConfig,
  RepoProvider,
  RepositoryLocation,
  RepositoryRemoteProvider,
  RepositoryRemoteType,
} from "@backlog/schemas";
import { listActiveRuns } from "./run-store.js";
import { readAgentsFile, writeAgentsFile } from "./agents.js";
import { deriveTaskStatusFromSubTasks } from "./task-service.js";
import { readSubTasksFile, readTasksFile, writeSubTasksFile, writeTasksFile } from "./state-files.js";

export interface AddRepoInput {
  id: string;
  path?: string;
  defaultBranch: string;
  role?: string;
  enabled?: boolean;
  accessMode?: RepoAccessMode;
  location?: RepositoryLocation;
  remoteType?: RepositoryRemoteType;
  remoteProvider?: RepositoryRemoteProvider;
  remoteUrl?: string;
  gitUrl?: string;
  provider?: RepoProvider;
}

export interface CloneAndAddRepoInput {
  url: string;
  remoteUrl?: string;
  id?: string;
  destDir?: string;
  defaultBranch?: string;
  role?: string;
  enabled?: boolean;
  accessMode?: RepoAccessMode;
  remoteProvider?: RepositoryRemoteProvider;
}

export interface UpdateRepoInput {
  id?: string;
  path?: string;
  defaultBranch?: string;
  role?: string;
  clearRole?: boolean;
  enabled?: boolean;
  accessMode?: RepoAccessMode;
  location?: RepositoryLocation;
  remoteType?: RepositoryRemoteType;
  clearRemoteType?: boolean;
  remoteProvider?: RepositoryRemoteProvider;
  clearRemoteProvider?: boolean;
  remoteUrl?: string;
  clearRemoteUrl?: boolean;
  gitUrl?: string;
  clearGitUrl?: boolean;
  provider?: RepoProvider;
  clearProvider?: boolean;
}

export interface CreateRepoCheckoutInput {
  path?: string;
  cloneUrl?: string;
}

function remoteProviderFromLegacy(provider: RepoProvider | undefined): RepositoryRemoteProvider | undefined {
  if (!provider || provider === "local") return undefined;
  return provider === "other" ? "custom" : provider;
}

function legacyProviderFromRemote(provider: RepositoryRemoteProvider | undefined): RepoProvider | undefined {
  if (!provider) return undefined;
  return provider === "custom" ? "other" : provider;
}

function workspaceRootFromBacklogDir(backlogDir: string): string {
  return path.dirname(backlogDir);
}

function normalizeRepoPath(backlogDir: string, repoPath: string): string {
  return path.resolve(workspaceRootFromBacklogDir(backlogDir), repoPath);
}

function ensureRepoPathExists(repoPath: string): void {
  if (!fs.existsSync(repoPath)) {
    throw new Error(`Configured repository path does not exist: ${repoPath}`);
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
  const hasCheckoutInput = Boolean(input.path);
  const normalizedPath = input.path ? normalizeRepoPath(backlogDir, input.path) : undefined;

  if (config.repos.some((repo) => repo.id === input.id)) {
    throw new Error(`Repository id already exists: ${input.id}`);
  }
  if (normalizedPath) {
    ensureRepoPathExists(normalizedPath);
  }
  if (normalizedPath && config.repos.some((repo) => repoCheckoutPath(repo) === normalizedPath)) {
    throw new Error(`Repository path already exists in this project: ${normalizedPath}`);
  }

  const remoteUrl = input.remoteUrl ?? input.gitUrl;
  const remoteProvider = input.remoteProvider ?? remoteProviderFromLegacy(input.provider);
  const location: RepositoryLocation = input.location ?? (
    remoteUrl || input.remoteType || remoteProvider ? "remote" : "local"
  );
  if (location === "local" && !hasCheckoutInput) {
    throw new Error("Local repositories require a local checkout path.");
  }
  const remoteType = input.remoteType ?? (location === "remote" && remoteUrl ? "git" : undefined);
  const legacyProvider = input.provider ?? legacyProviderFromRemote(remoteProvider);
  const legacyGitUrl = input.gitUrl ?? (remoteType === "git" ? remoteUrl : undefined);

  const repo: RepoConfig = {
    id: input.id,
    default_branch: input.defaultBranch,
    ...(normalizedPath ? { path: normalizedPath, checkout_path: normalizedPath } : {}),
    ...(input.role ? { role: input.role } : {}),
    enabled: input.enabled ?? true,
    access_mode: input.accessMode ?? "read-write",
    location,
    ...(remoteType ? { remote_type: remoteType } : {}),
    ...(remoteProvider ? { remote_provider: remoteProvider } : {}),
    ...(remoteUrl ? { remote_url: remoteUrl } : {}),
    ...(legacyGitUrl ? { git_url: legacyGitUrl } : {}),
    ...(legacyProvider ? { provider: legacyProvider } : {}),
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
    throw new Error(`Repository id already exists: ${id}`);
  }
  const projectRoot = workspaceRootFromBacklogDir(backlogDir);
  const destDir = input.destDir
    ? path.resolve(projectRoot, input.destDir)
    : path.resolve(projectRoot, "repositories", id);
  if (config.repos.some((repo) => repoCheckoutPath(repo) === destDir)) {
    throw new Error(`Repository path already exists in this project: ${destDir}`);
  }

  const cloneOptions: Parameters<typeof cloneRepo>[0] = {
    url: input.url,
    dest: destDir,
  };
  if (input.defaultBranch) cloneOptions.branch = input.defaultBranch;
  await cloneRepo(cloneOptions);

  const storedRemoteUrl = input.remoteUrl ?? input.url;
  const provider = detectGitProvider(storedRemoteUrl);
  return addRepo(backlogDir, {
    id,
    path: destDir,
    defaultBranch: input.defaultBranch ?? config.default_branch,
    ...(input.role ? { role: input.role } : {}),
    enabled: input.enabled ?? true,
    ...(input.accessMode ? { accessMode: input.accessMode } : {}),
    location: "remote",
    remoteType: "git",
    remoteProvider: input.remoteProvider ?? remoteProviderFromLegacy(provider) ?? "custom",
    remoteUrl: storedRemoteUrl,
    gitUrl: storedRemoteUrl,
    provider,
  });
}

export function updateRepo(backlogDir: string, repoId: string, input: UpdateRepoInput): RepoConfig {
  const config = loadConfig(backlogDir);
  const repo = config.repos.find((candidate) => candidate.id === repoId);
  if (!repo) {
    throw new Error(`Unknown repository: ${repoId}`);
  }

  const activeClaims = listActiveClaims(backlogDir).filter((claim) => claim.repo === repoId);
  const activeRuns = listActiveRuns(backlogDir).filter((run) => run.repo === repoId);
  if ((input.id !== undefined || input.path !== undefined) && (activeClaims.length > 0 || activeRuns.length > 0)) {
    throw new Error(`Cannot change repository identity for ${repoId} while active claims or runs still reference it.`);
  }

  if (input.id !== undefined && input.id !== repoId && config.repos.some((candidate) => candidate.id === input.id)) {
      throw new Error(`Repository id already exists: ${input.id}`);
  }

  let normalizedPath: string | undefined;
  if (input.path !== undefined) {
    normalizedPath = normalizeRepoPath(backlogDir, input.path);
    ensureRepoPathExists(normalizedPath);
    if (config.repos.some((candidate) => candidate.id !== repoId && repoCheckoutPath(candidate) === normalizedPath)) {
      throw new Error(`Repository path already exists in this project: ${normalizedPath}`);
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

    const workItemsFile = readTasksFile(backlogDir);
    let workItemsChanged = false;
    for (const item of workItemsFile.tasks) {
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
      writeTasksFile(backlogDir, workItemsFile);
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
    repo.checkout_path = normalizedPath;
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
  if (input.accessMode !== undefined) {
    repo.access_mode = input.accessMode;
  }
  if (input.location !== undefined) {
    repo.location = input.location;
  }
  if (input.remoteType !== undefined) {
    repo.remote_type = input.remoteType;
  }
  if (input.clearRemoteType) {
    delete repo.remote_type;
  }
  if (input.remoteProvider !== undefined) {
    repo.remote_provider = input.remoteProvider;
    const provider = legacyProviderFromRemote(input.remoteProvider);
    if (provider) repo.provider = provider;
  }
  if (input.clearRemoteProvider) {
    delete repo.remote_provider;
    delete repo.provider;
  }
  if (input.remoteUrl !== undefined) {
    repo.remote_url = input.remoteUrl;
    if ((input.remoteType ?? repo.remote_type) === "git") {
      repo.git_url = input.remoteUrl;
    }
  }
  if (input.clearRemoteUrl) {
    delete repo.remote_url;
    delete repo.git_url;
  }
  if (input.gitUrl !== undefined) {
    repo.git_url = input.gitUrl;
    repo.remote_url = input.gitUrl;
    repo.remote_type = "git";
    repo.location = "remote";
  }
  if (input.clearGitUrl) {
    delete repo.git_url;
  }
  if (input.provider !== undefined) {
    repo.provider = input.provider;
    const remoteProvider = remoteProviderFromLegacy(input.provider);
    if (remoteProvider) {
      repo.remote_provider = remoteProvider;
      repo.location = "remote";
    }
  }
  if (input.clearProvider) {
    delete repo.provider;
  }

  saveConfig(backlogDir, config);
  return repo;
}

export async function createRepoCheckout(
  backlogDir: string,
  repoId: string,
  input: CreateRepoCheckoutInput = {},
): Promise<RepoConfig> {
  const config = loadConfig(backlogDir);
  const repo = config.repos.find((candidate) => candidate.id === repoId);
  if (!repo) {
    throw new Error(`Unknown repository: ${repoId}`);
  }
  if ((repo.remote_type ?? (repo.remote_url ?? repo.git_url ? "git" : undefined)) !== "git") {
    throw new Error(`Repository ${repoId} is not a Git remote.`);
  }
  const cloneUrl = input.cloneUrl ?? repo.remote_url ?? repo.git_url;
  if (!cloneUrl) {
    throw new Error(`Repository ${repoId} has no remote URL.`);
  }

  const existingCheckout = repoCheckoutPath(repo);
  if (existingCheckout && fs.existsSync(existingCheckout)) {
    throw new Error(`Repository ${repoId} already has a local checkout: ${existingCheckout}`);
  }
  const defaultDest = existingCheckout ?? path.resolve(workspaceRootFromBacklogDir(backlogDir), "repositories", repo.id);
  const dest = input.path ? normalizeRepoPath(backlogDir, input.path) : defaultDest;
  if (config.repos.some((candidate) => candidate.id !== repo.id && repoCheckoutPath(candidate) === dest)) {
    throw new Error(`Repository path already exists in this project: ${dest}`);
  }

  const cloneOptions: Parameters<typeof cloneRepo>[0] = {
    url: cloneUrl,
    dest,
  };
  if (repo.default_branch) cloneOptions.branch = repo.default_branch;
  await cloneRepo(cloneOptions);

  repo.path = dest;
  repo.checkout_path = dest;
  repo.location = "remote";
  repo.remote_type = "git";
  saveConfig(backlogDir, config);
  return repo;
}

export function removeRepo(backlogDir: string, repoId: string, options?: { force?: boolean }): RepoConfig {
  const config = loadConfig(backlogDir);
  const repoIndex = config.repos.findIndex((candidate) => candidate.id === repoId);
  if (repoIndex < 0) {
    throw new Error(`Unknown repository: ${repoId}`);
  }

  const activeClaims = listActiveClaims(backlogDir).filter((claim) => claim.repo === repoId);
  if (activeClaims.length > 0) {
    throw new Error(`Cannot remove repository ${repoId} while ${activeClaims.length} active claim(s) still reference it.`);
  }

  const activeRuns = listActiveRuns(backlogDir).filter((run) => run.repo === repoId);
  if (activeRuns.length > 0) {
    throw new Error(`Cannot remove repository ${repoId} while ${activeRuns.length} active run(s) still reference it.`);
  }

  const tasksFile = readSubTasksFile(backlogDir);
  const linkedTasks = tasksFile.subtasks.filter((task) => task.repo === repoId);
  const tasksFileForProject = readTasksFile(backlogDir);
  const linkedProjectTasks = tasksFileForProject.tasks.filter((item) => item.repo_targets.includes(repoId) || item.planning.preferred_lane === repoId);
  const agentsFile = readAgentsFile(backlogDir);
  const linkedAgents = agentsFile.agents.filter((agent) => agent.allowed_repos.includes(repoId));

  if (!options?.force && (linkedTasks.length > 0 || linkedProjectTasks.length > 0 || linkedAgents.length > 0)) {
    throw new Error(
      `Repository ${repoId} is still referenced by ${linkedProjectTasks.length} task(s), ${linkedTasks.length} subtask(s), and ${linkedAgents.length} agent(s). Re-run with --force.`,
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

    let projectTasksChanged = false;
    const affectedProjectTasks = new Set(linkedTasks.map((task) => task.task_id));
    for (const item of tasksFileForProject.tasks) {
      let changed = false;
      if (item.repo_targets.includes(repoId)) {
        item.repo_targets = item.repo_targets.filter((candidate) => candidate !== repoId);
        changed = true;
      }
      if (item.planning.preferred_lane === repoId) {
        delete item.planning.preferred_lane;
        changed = true;
      }
      if (affectedProjectTasks.has(item.id)) {
        item.status = deriveTaskStatusFromSubTasks(backlogDir, item.id) ?? "ready";
        changed = true;
      }
      if (changed) {
        item.updated_at = new Date().toISOString();
        projectTasksChanged = true;
      }
    }
    if (projectTasksChanged) {
      writeTasksFile(backlogDir, tasksFileForProject);
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
    throw new Error(`Unknown repository: ${repoId}`);
  }
  saveConfig(backlogDir, config);
  return removed;
}
