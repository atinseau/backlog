import fs from "node:fs";
import path from "node:path";
import {
  type ProjectRegistry,
  type ProjectRegistryEntry,
  projectRegistrySchema,
} from "@backlog/schemas";
import { loadConfig } from "./load-config.js";
import { getBacklogUserDir } from "./user-paths.js";
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

// Legacy registries lived at ~/Library/Application Support/Backlog/workspaces.json
// with an inner `workspaces: []` key. New shape is `projects.json` with `projects: []`.
// Move-and-rewrite on first load if we still see the old file.
const LEGACY_INNER_KEY = "workspaces";
const FRESH_INNER_KEY = "projects";

function migrateLegacyRegistry(options?: RegistryOptions): void {
  const dir = resolveRegistryDir(options);
  const newPath = path.join(dir, REGISTRY_FILE);
  const oldPath = path.join(dir, LEGACY_REGISTRY_FILE);
  if (!fs.existsSync(oldPath) || fs.existsSync(newPath)) return;
  const raw = JSON.parse(fs.readFileSync(oldPath, "utf8")) as Record<string, unknown>;
  if (LEGACY_INNER_KEY in raw && !(FRESH_INNER_KEY in raw)) {
    raw[FRESH_INNER_KEY] = raw[LEGACY_INNER_KEY];
    delete raw[LEGACY_INNER_KEY];
  }
  fs.writeFileSync(newPath, JSON.stringify(raw, null, 2) + "\n", "utf8");
  fs.unlinkSync(oldPath);
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

export interface RegisterWorkspaceInput {
  projectRoot: string;
}

export function registerProject(
  input: RegisterWorkspaceInput,
  options?: RegistryOptions,
): ProjectRegistryEntry {
  const projectRoot = path.resolve(input.projectRoot);
  const backlogDir = path.join(projectRoot, ".backlog");
  if (!fs.existsSync(backlogDir)) {
    throw new Error(`No .backlog directory at ${projectRoot}`);
  }
  const id = ensureProjectId(backlogDir);
  const config = loadConfig(backlogDir);
  const now = new Date().toISOString();
  const entry: ProjectRegistryEntry = {
    id,
    path: projectRoot,
    name: config.project_name,
    added_at: now,
    last_opened_at: now,
  };

  const registry = loadRegistry(options);
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
