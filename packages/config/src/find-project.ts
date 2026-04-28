import fs from "node:fs";
import path from "node:path";
import { getRegistryPath, listRegisteredProjects, type RegistryOptions } from "./project-registry.js";
import { loadConfig } from "./load-config.js";

export interface ProjectPaths {
  // For in_repo: the project root containing the .backlog/ subdirectory.
  // For user_level: the workspace dir itself (no inner .backlog/).
  root: string;
  // The dir containing config.toml + state files. For in_repo this is
  // <root>/.backlog/, for user_level it's the same as `root`.
  backlogDir: string;
}

export interface FindProjectOptions {
  // Override the registry directory (used in tests).
  registryOptions?: RegistryOptions;
  // Skip the registry-based fallback (used when we explicitly want the
  // upward `.backlog/` walk only).
  skipRegistry?: boolean;
}

// Cached repo→workspace map keyed by registry path. Invalidated when the
// registry file's mtime changes, so an external `backlog project add`
// from another process is picked up at the next call. The cache lives
// for the process's lifetime — short-lived CLI invocations refill on
// each fresh process, long-running daemons (`backlog serve`) get the
// real benefit.
interface RegistryCacheEntry {
  // Stat key: mtime in ms. Bumping the registry file resets the cache.
  mtimeMs: number;
  // Each user_level entry's resolved repo paths and workspace dir.
  workspaces: { workspaceDir: string; repoPaths: string[] }[];
}

const registryCache = new Map<string, RegistryCacheEntry>();

// Test hook: drop the cache between scenarios so a registry edit and a
// findProject call land deterministically. Production code never calls
// this.
export function clearFindProjectCache(): void {
  registryCache.clear();
}

// 1. BACKLOG_PROJECT_DIR env var lets the pre-commit hook (or any other
//    out-of-tree caller) point us at a workspace directly. Accepts either
//    a project root with a .backlog/ subdir or a user_level workspace dir
//    (containing config.toml at its root).
// 2. If cwd itself is a user_level workspace (has config.toml at its root),
//    return that directly. Lets you run `backlog …` from inside
//    ~/.backlog/<name>/ without going through the registry.
// 3. Walk up from cwd looking for a .backlog/ subdirectory that contains a
//    config.toml. Covers in_repo workspaces. The config.toml check matters
//    because the user-level root ~/.backlog/ ITSELF is a directory named
//    .backlog — without the check, the walk would mistake it for an
//    in_repo workspace anytime cwd is under it.
// 4. Fall back to the user-level project registry: for each user_level
//    entry, load its config.toml and check whether cwd sits inside any of
//    its registered repos. The first match wins.
export function findProject(startDir = process.cwd(), options: FindProjectOptions = {}): ProjectPaths | null {
  const envOverride = process.env.BACKLOG_PROJECT_DIR;
  if (envOverride && envOverride.length > 0) {
    const resolved = resolveExplicitDir(envOverride);
    if (resolved) return resolved;
  }

  const cwd = path.resolve(startDir);

  // user_level: cwd is itself the workspace dir.
  if (fs.existsSync(path.join(cwd, "config.toml"))) {
    return { root: cwd, backlogDir: cwd };
  }

  const upward = walkUpForBacklogDir(cwd);
  if (upward) return upward;

  if (options.skipRegistry) return null;

  return findUserLevelProjectForCwd(cwd, options.registryOptions);
}

function walkUpForBacklogDir(startDir: string): ProjectPaths | null {
  let current = startDir;
  while (true) {
    const backlogDir = path.join(current, ".backlog");
    if (
      fs.existsSync(backlogDir) &&
      fs.statSync(backlogDir).isDirectory() &&
      fs.existsSync(path.join(backlogDir, "config.toml"))
    ) {
      return { root: current, backlogDir };
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function resolveExplicitDir(rawDir: string): ProjectPaths | null {
  const dir = path.resolve(rawDir);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return null;
  // user_level: the dir itself contains config.toml.
  if (fs.existsSync(path.join(dir, "config.toml"))) {
    return { root: dir, backlogDir: dir };
  }
  // in_repo: the dir is a project root with a .backlog/ child.
  const backlogDir = path.join(dir, ".backlog");
  if (fs.existsSync(backlogDir) && fs.statSync(backlogDir).isDirectory()) {
    return { root: dir, backlogDir };
  }
  return null;
}

// Build (or read from cache) the list of user_level workspaces with
// their resolved repo paths. Reading every config.toml on every CLI
// invocation gets expensive at 5+ projects with 10+ repos each.
function loadUserLevelIndex(registryOptions?: RegistryOptions): RegistryCacheEntry["workspaces"] {
  const registryPath = getRegistryPath(registryOptions);
  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(registryPath).mtimeMs;
  } catch {
    // Missing registry → empty index.
    return [];
  }

  const cached = registryCache.get(registryPath);
  if (cached && cached.mtimeMs === mtimeMs) {
    return cached.workspaces;
  }

  let entries;
  try {
    entries = listRegisteredProjects(registryOptions);
  } catch {
    return [];
  }

  const workspaces: RegistryCacheEntry["workspaces"] = [];
  for (const entry of entries) {
    if (entry.location !== "user_level") continue;
    const workspaceDir = path.resolve(entry.path);
    if (!fs.existsSync(path.join(workspaceDir, "config.toml"))) continue;
    let config;
    try {
      config = loadConfig(workspaceDir);
    } catch {
      continue;
    }
    workspaces.push({
      workspaceDir,
      repoPaths: config.repos.map((repo) => path.resolve(repo.path)),
    });
  }

  registryCache.set(registryPath, { mtimeMs, workspaces });
  return workspaces;
}

function findUserLevelProjectForCwd(
  cwd: string,
  registryOptions?: RegistryOptions,
): ProjectPaths | null {
  // Two match shapes:
  //   1. cwd is INSIDE one of the configured repos (the common case
  //      — running CLI from inside a repo's tree).
  //   2. cwd is the COMMON PARENT of multiple configured repos. This
  //      catches the multi-repo project layout where the workspace
  //      lives at ~/.backlog/<slug>/ and repos sit at ~/Dev/<slug>/<repo-i>;
  //      running the CLI from ~/Dev/<slug>/ should resolve.
  // Match #2 only fires when at least 2 configured repos are direct
  // children of cwd — a single repo as a child isn't enough signal
  // (could be coincidence with another project).
  for (const ws of loadUserLevelIndex(registryOptions)) {
    let descendantHits = 0;
    let parentChildren = 0;
    for (const repoPath of ws.repoPaths) {
      if (cwd === repoPath || cwd.startsWith(repoPath + path.sep)) {
        descendantHits++;
      }
      if (path.dirname(repoPath) === cwd) {
        parentChildren++;
      }
    }
    if (descendantHits > 0 || parentChildren >= 2) {
      return { root: ws.workspaceDir, backlogDir: ws.workspaceDir };
    }
  }
  return null;
}
