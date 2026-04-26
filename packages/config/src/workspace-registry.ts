import fs from "node:fs";
import path from "node:path";
import {
  type WorkspaceRegistry,
  type WorkspaceRegistryEntry,
  workspaceRegistrySchema,
} from "@backlog/schemas";
import { loadConfig } from "./load-config.js";
import { getBacklogUserDir } from "./user-paths.js";
import { ensureWorkspaceId } from "./workspace-id.js";

export interface RegistryOptions {
  dir?: string;
}

const REGISTRY_VERSION = 1;
const REGISTRY_FILE = "workspaces.json";

function resolveRegistryDir(options?: RegistryOptions): string {
  return options?.dir ?? getBacklogUserDir();
}

export function getRegistryPath(options?: RegistryOptions): string {
  return path.join(resolveRegistryDir(options), REGISTRY_FILE);
}

function emptyRegistry(): WorkspaceRegistry {
  return { version: REGISTRY_VERSION, workspaces: [] };
}

export function loadRegistry(options?: RegistryOptions): WorkspaceRegistry {
  const registryPath = getRegistryPath(options);
  if (!fs.existsSync(registryPath)) return emptyRegistry();
  const raw = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  return workspaceRegistrySchema.parse(raw);
}

export function saveRegistry(registry: WorkspaceRegistry, options?: RegistryOptions): void {
  const dir = resolveRegistryDir(options);
  fs.mkdirSync(dir, { recursive: true });
  const registryPath = path.join(dir, REGISTRY_FILE);
  const tmpPath = `${registryPath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(registry, null, 2) + "\n", "utf8");
  fs.renameSync(tmpPath, registryPath);
}

export function listRegisteredWorkspaces(options?: RegistryOptions): WorkspaceRegistryEntry[] {
  return loadRegistry(options).workspaces;
}

export interface RegisterWorkspaceInput {
  workspaceRoot: string;
}

export function registerWorkspace(
  input: RegisterWorkspaceInput,
  options?: RegistryOptions,
): WorkspaceRegistryEntry {
  const workspaceRoot = path.resolve(input.workspaceRoot);
  const backlogDir = path.join(workspaceRoot, ".backlog");
  if (!fs.existsSync(backlogDir)) {
    throw new Error(`No .backlog directory at ${workspaceRoot}`);
  }
  const id = ensureWorkspaceId(backlogDir);
  const config = loadConfig(backlogDir);
  const now = new Date().toISOString();
  const entry: WorkspaceRegistryEntry = {
    id,
    path: workspaceRoot,
    name: config.workspace_name,
    added_at: now,
    last_opened_at: now,
  };

  const registry = loadRegistry(options);
  // Drop anything matching either the same id or the same path so we don't
  // accumulate duplicates if a workspace gets re-registered after a move
  // or a re-init.
  const previousAddedAt = registry.workspaces.find((w) => w.id === id)?.added_at;
  registry.workspaces = registry.workspaces.filter((w) => w.id !== id && w.path !== workspaceRoot);
  if (previousAddedAt) entry.added_at = previousAddedAt;
  registry.workspaces.push(entry);
  saveRegistry(registry, options);
  return entry;
}

export function unregisterWorkspace(
  idOrPath: string,
  options?: RegistryOptions,
): WorkspaceRegistryEntry | null {
  const registry = loadRegistry(options);
  const target = path.isAbsolute(idOrPath) ? path.resolve(idOrPath) : idOrPath;
  const index = registry.workspaces.findIndex((w) => w.id === idOrPath || w.path === target);
  if (index === -1) return null;
  const [removed] = registry.workspaces.splice(index, 1);
  saveRegistry(registry, options);
  return removed ?? null;
}

export function touchWorkspace(id: string, options?: RegistryOptions): void {
  const registry = loadRegistry(options);
  const entry = registry.workspaces.find((w) => w.id === id);
  if (!entry) return;
  entry.last_opened_at = new Date().toISOString();
  saveRegistry(registry, options);
}
