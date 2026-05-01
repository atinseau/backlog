import fs from "node:fs";
import path from "node:path";
import {
  type ProjectLocation,
  type ProjectRegistry,
  type ProjectRegistryEntry,
  projectRegistrySchema,
} from "@backlog/schemas";
import { loadConfig } from "./load-config.js";
import { getBacklogUserDir, getLegacyBacklogConfigDir } from "./user-paths.js";
import { ensureProjectId } from "./project-id.js";

export interface RegistryOptions {
  dir?: string;
}

const REGISTRY_VERSION = 1;
const REGISTRY_FILE = "projects.json";
const LEGACY_REGISTRY_FILE = "workspaces.json";

function resolveRegistryDir(options?: RegistryOptions): string {
  return options?.dir ?? getBacklogUserDir();
}

export function getRegistryPath(options?: RegistryOptions): string {
  return path.join(resolveRegistryDir(options), REGISTRY_FILE);
}

function emptyRegistry(): ProjectRegistry {
  return { version: REGISTRY_VERSION, projects: [] };
}

// Two layers of legacy migration on first load:
//   1. The registry used to live at ~/Library/Application Support/Backlog/
//      (macOS) / $XDG_CONFIG_HOME/Backlog/ (Linux) / %APPDATA%\Backlog\
//      (Windows). It now lives at ~/.backlog/ on every platform.
//   2. Within that directory, the file used to be workspaces.json with an
//      inner `workspaces: []` key. It is now projects.json with `projects: []`.
const LEGACY_INNER_KEY = "workspaces";
const FRESH_INNER_KEY = "projects";

function migrateLegacyRegistry(options?: RegistryOptions): void {
  // Skip both legacy migrations entirely when the caller supplied an
  // explicit dir (tests use this to isolate state).
  if (options?.dir) return;

  const newDir = getBacklogUserDir();
  const newPath = path.join(newDir, REGISTRY_FILE);
  if (fs.existsSync(newPath)) return;

  // 1. Look for projects.json or workspaces.json at the legacy platform-
  //    specific config dir. If we find either, copy/normalize it into the
  //    new ~/.backlog/ location and remove the original.
  const legacyDir = getLegacyBacklogConfigDir();
  const legacyProjectsPath = path.join(legacyDir, REGISTRY_FILE);
  const legacyWorkspacesPath = path.join(legacyDir, LEGACY_REGISTRY_FILE);
  let migratedFromPath: string | null = null;
  let raw: Record<string, unknown> | null = null;

  if (fs.existsSync(legacyProjectsPath)) {
    raw = JSON.parse(fs.readFileSync(legacyProjectsPath, "utf8")) as Record<string, unknown>;
    migratedFromPath = legacyProjectsPath;
  } else if (fs.existsSync(legacyWorkspacesPath)) {
    raw = JSON.parse(fs.readFileSync(legacyWorkspacesPath, "utf8")) as Record<string, unknown>;
    migratedFromPath = legacyWorkspacesPath;
  } else {
    // 2. Or look for workspaces.json sitting next to the new location
    //    (older alpha installs of the new layout used the old filename).
    const workspacesAtNewDir = path.join(newDir, LEGACY_REGISTRY_FILE);
    if (fs.existsSync(workspacesAtNewDir)) {
      raw = JSON.parse(fs.readFileSync(workspacesAtNewDir, "utf8")) as Record<string, unknown>;
      migratedFromPath = workspacesAtNewDir;
    }
  }

  if (!raw || !migratedFromPath) return;

  // Normalize inner key.
  if (LEGACY_INNER_KEY in raw && !(FRESH_INNER_KEY in raw)) {
    raw[FRESH_INNER_KEY] = raw[LEGACY_INNER_KEY];
    delete raw[LEGACY_INNER_KEY];
  }

  fs.mkdirSync(newDir, { recursive: true });
  fs.writeFileSync(newPath, JSON.stringify(raw, null, 2) + "\n", "utf8");
  fs.unlinkSync(migratedFromPath);
}

export function loadRegistry(options?: RegistryOptions): ProjectRegistry {
  migrateLegacyRegistry(options);
  const registryPath = getRegistryPath(options);
  if (!fs.existsSync(registryPath)) return emptyRegistry();
  const raw = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  return projectRegistrySchema.parse(raw);
}

export function saveRegistry(registry: ProjectRegistry, options?: RegistryOptions): void {
  const dir = resolveRegistryDir(options);
  fs.mkdirSync(dir, { recursive: true });
  const registryPath = path.join(dir, REGISTRY_FILE);
  const tmpPath = `${registryPath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(registry, null, 2) + "\n", "utf8");
  fs.renameSync(tmpPath, registryPath);
}

export function listRegisteredProjects(options?: RegistryOptions): ProjectRegistryEntry[] {
  return loadRegistry(options).projects;
}

export interface RegisterProjectInput {
  // For in_repo: the project root that contains .backlog/.
  // For user_level: the project data dir itself (config.toml lives at its root).
  projectRoot: string;
  // If omitted, inferred from disk: presence of <projectRoot>/.backlog/ ⇒
  // in_repo, presence of <projectRoot>/config.toml ⇒ user_level.
  location?: ProjectLocation;
}

function detectProjectLayout(projectRoot: string): { backlogDir: string; location: ProjectLocation } {
  const inRepoDir = path.join(projectRoot, ".backlog");
  if (fs.existsSync(inRepoDir) && fs.statSync(inRepoDir).isDirectory()) {
    return { backlogDir: inRepoDir, location: "in_repo" };
  }
  if (fs.existsSync(path.join(projectRoot, "config.toml"))) {
    return { backlogDir: projectRoot, location: "user_level" };
  }
  throw new Error(
    `No Backlog project at ${projectRoot} (looked for .backlog/ and config.toml)`,
  );
}

export function registerProject(
  input: RegisterProjectInput,
  options?: RegistryOptions,
): ProjectRegistryEntry {
  const projectRoot = path.resolve(input.projectRoot);
  const detected = detectProjectLayout(projectRoot);
  const location = input.location ?? detected.location;
  if (input.location && input.location !== detected.location) {
    throw new Error(
      `Layout mismatch: requested location=${input.location} but disk shows ${detected.location} at ${projectRoot}`,
    );
  }
  const id = ensureProjectId(detected.backlogDir);
  const config = loadConfig(detected.backlogDir);
  const now = new Date().toISOString();

  const registry = loadRegistry(options);
  // Block name collisions for user_level entries: two user-level projects
  // sharing a name would resolve to the same ~/.backlog/<slug>/ dir on
  // future re-inits and silently clobber each other.
  if (location === "user_level") {
    const collision = registry.projects.find(
      (p) => p.location === "user_level" && p.id !== id && p.name === config.project_name,
    );
    if (collision) {
      throw new Error(
        `A user-level project named "${config.project_name}" is already registered (id=${collision.id} at ${collision.path}). Pick a different name.`,
      );
    }
  }

  const entry: ProjectRegistryEntry = {
    id,
    path: projectRoot,
    name: config.project_name,
    added_at: now,
    last_opened_at: now,
    location,
    migration_history: [],
  };
  // Drop anything matching either the same id or the same path so we don't
  // accumulate duplicates if a project gets re-registered after a move
  // or a re-init.
  const previousAddedAt = registry.projects.find((p) => p.id === id)?.added_at;
  registry.projects = registry.projects.filter((p) => p.id !== id && p.path !== projectRoot);
  if (previousAddedAt) entry.added_at = previousAddedAt;
  registry.projects.push(entry);
  saveRegistry(registry, options);
  return entry;
}

export function unregisterProject(
  idOrPath: string,
  options?: RegistryOptions,
): ProjectRegistryEntry | null {
  const registry = loadRegistry(options);
  const target = path.isAbsolute(idOrPath) ? path.resolve(idOrPath) : idOrPath;
  const index = registry.projects.findIndex((p) => p.id === idOrPath || p.path === target);
  if (index === -1) return null;
  const [removed] = registry.projects.splice(index, 1);
  saveRegistry(registry, options);
  return removed ?? null;
}

export function touchProject(id: string, options?: RegistryOptions): void {
  const registry = loadRegistry(options);
  const entry = registry.projects.find((p) => p.id === id);
  if (!entry) return;
  entry.last_opened_at = new Date().toISOString();
  saveRegistry(registry, options);
}
