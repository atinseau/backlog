import fs from "node:fs";
import path from "node:path";
import type { ProjectRegistryEntry, RepoConfig } from "@backlog/schemas";
import { loadConfig } from "./load-config.js";
import { saveConfig } from "./save-config.js";
import {
  type RegistryOptions,
  listRegisteredProjects,
  loadRegistry,
  saveRegistry,
} from "./project-registry.js";
import { userLevelWorkspaceDir } from "./init-layout.js";

// What we hand back to the caller. The CLI uses `reposToReinstallHooksOn`
// to iterate and call @backlog/hooks::installPreCommitHook on each (we
// keep the hook dependency out of @backlog/config to avoid a cycle).
export interface MigrationResult {
  // Where the workspace data lived before this migration. For in_repo
  // sources this was <oldRoot>/.backlog/; for user_level it was oldRoot.
  oldRoot: string;
  oldBacklogDir: string;
  // Where the workspace data lives now. Same shape as above for the new
  // location.
  newRoot: string;
  newBacklogDir: string;
  // Updated registry entry pointing at the new location.
  entry: ProjectRegistryEntry;
  // If the old dir was archived (renamed to .migrated-YYYY-MM-DD/), this is
  // the post-rename path. undefined if --keep-old kept it in place.
  archivedAt?: string;
  // Configured repos in the migrated workspace. The caller should reinstall
  // the pre-commit hook in each so they point at newBacklogDir.
  reposToReinstallHooksOn: RepoConfig[];
}

export interface MigrateToUserLevelOptions {
  // Project to migrate, identified by id (WS-…), absolute path, or name.
  identifier: string;
  // Optional rename. Becomes both the new project_name and the slug for
  // the user-level dir (~/.backlog/<slug>/). Must not collide with any
  // other registered user_level project.
  newName?: string;
  // When true, leave the old <root>/.backlog/ in place instead of renaming
  // it to .backlog.migrated-YYYY-MM-DD/.
  keepOld?: boolean;
  // Override the registry directory (used in tests).
  registryOptions?: RegistryOptions;
}

export interface MigrateToInRepoOptions {
  identifier: string;
  // Repo id to host the embedded .backlog/. Must already be configured in
  // the source workspace.
  intoRepoId: string;
  keepOld?: boolean;
  registryOptions?: RegistryOptions;
}

function findRegistryEntry(
  identifier: string,
  options?: RegistryOptions,
): ProjectRegistryEntry | null {
  const target = path.isAbsolute(identifier) ? path.resolve(identifier) : identifier;
  return (
    listRegisteredProjects(options).find(
      (p) => p.id === identifier || p.path === target || p.name === identifier,
    ) ?? null
  );
}

function copyDirContents(from: string, to: string): void {
  fs.mkdirSync(to, { recursive: true });
  fs.cpSync(from, to, { recursive: true, dereference: false, errorOnExist: false, force: false });
}

function todayUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function migrateProjectToUserLevel(options: MigrateToUserLevelOptions): MigrationResult {
  const entry = findRegistryEntry(options.identifier, options.registryOptions);
  if (!entry) {
    throw new Error(`No registered project matching: ${options.identifier}`);
  }
  if (entry.location === "user_level") {
    throw new Error(`Project ${entry.id} is already at location=user_level.`);
  }

  const oldRoot = path.resolve(entry.path);
  const oldBacklogDir = path.join(oldRoot, ".backlog");
  if (!fs.existsSync(path.join(oldBacklogDir, "config.toml"))) {
    throw new Error(`Workspace at ${oldBacklogDir} has no config.toml.`);
  }

  const sourceConfig = loadConfig(oldBacklogDir);
  const newName = options.newName ?? sourceConfig.project_name;

  const collision = listRegisteredProjects(options.registryOptions).find(
    (p) => p.location === "user_level" && p.id !== entry.id && p.name === newName,
  );
  if (collision) {
    throw new Error(
      `A user-level project named "${newName}" already exists (id=${collision.id} at ${collision.path}). Pick a different name.`,
    );
  }

  const newRoot = userLevelWorkspaceDir(newName);
  if (fs.existsSync(path.join(newRoot, "config.toml"))) {
    throw new Error(`Target ${newRoot} already has a Backlog workspace. Move or remove it first.`);
  }

  copyDirContents(oldBacklogDir, newRoot);

  const migrated = loadConfig(newRoot);
  migrated.project_location = "user_level";
  if (newName !== migrated.project_name) migrated.project_name = newName;
  saveConfig(newRoot, migrated);

  const registry = loadRegistry(options.registryOptions);
  const idx = registry.projects.findIndex((p) => p.id === entry.id);
  const updatedEntry: ProjectRegistryEntry = {
    ...entry,
    path: newRoot,
    name: newName,
    location: "user_level",
    last_opened_at: new Date().toISOString(),
  };
  if (idx >= 0) {
    registry.projects[idx] = updatedEntry;
    saveRegistry(registry, options.registryOptions);
  }

  let archivedAt: string | undefined;
  if (!options.keepOld) {
    archivedAt = `${oldBacklogDir}.migrated-${todayUtcDate()}`;
    fs.renameSync(oldBacklogDir, archivedAt);
  }

  return {
    oldRoot,
    oldBacklogDir,
    newRoot,
    newBacklogDir: newRoot,
    entry: updatedEntry,
    ...(archivedAt ? { archivedAt } : {}),
    reposToReinstallHooksOn: migrated.repos,
  };
}

export function migrateProjectToInRepo(options: MigrateToInRepoOptions): MigrationResult {
  const entry = findRegistryEntry(options.identifier, options.registryOptions);
  if (!entry) {
    throw new Error(`No registered project matching: ${options.identifier}`);
  }
  if (entry.location === "in_repo") {
    throw new Error(`Project ${entry.id} is already at location=in_repo.`);
  }

  const oldRoot = path.resolve(entry.path);
  const oldBacklogDir = oldRoot;
  if (!fs.existsSync(path.join(oldBacklogDir, "config.toml"))) {
    throw new Error(`Workspace at ${oldBacklogDir} has no config.toml.`);
  }

  const sourceConfig = loadConfig(oldBacklogDir);
  const targetRepo = sourceConfig.repos.find((r) => r.id === options.intoRepoId);
  if (!targetRepo) {
    throw new Error(
      `Unknown repo: ${options.intoRepoId}. Configured repos: ${sourceConfig.repos.map((r) => r.id).join(", ") || "(none)"}`,
    );
  }
  const newRoot = path.resolve(targetRepo.path);
  const newBacklogDir = path.join(newRoot, ".backlog");
  if (fs.existsSync(newBacklogDir)) {
    throw new Error(`${newBacklogDir} already exists. Remove it before migrating.`);
  }

  copyDirContents(oldBacklogDir, newBacklogDir);

  const migrated = loadConfig(newBacklogDir);
  migrated.project_location = "in_repo";
  saveConfig(newBacklogDir, migrated);

  const registry = loadRegistry(options.registryOptions);
  const idx = registry.projects.findIndex((p) => p.id === entry.id);
  const updatedEntry: ProjectRegistryEntry = {
    ...entry,
    path: newRoot,
    location: "in_repo",
    last_opened_at: new Date().toISOString(),
  };
  if (idx >= 0) {
    registry.projects[idx] = updatedEntry;
    saveRegistry(registry, options.registryOptions);
  }

  let archivedAt: string | undefined;
  if (!options.keepOld) {
    archivedAt = `${oldRoot}.migrated-${todayUtcDate()}`;
    fs.renameSync(oldRoot, archivedAt);
  }

  return {
    oldRoot,
    oldBacklogDir,
    newRoot,
    newBacklogDir,
    entry: updatedEntry,
    ...(archivedAt ? { archivedAt } : {}),
    reposToReinstallHooksOn: migrated.repos,
  };
}
