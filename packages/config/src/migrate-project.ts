import fs from "node:fs";
import path from "node:path";
import type { ProjectMigrationRecord, ProjectRegistryEntry, RepoConfig } from "@backlog/schemas";
import { loadConfig } from "./load-config.js";
import { saveConfig } from "./save-config.js";
import {
  type RegistryOptions,
  listRegisteredProjects,
  loadRegistry,
  saveRegistry,
} from "./project-registry.js";
import { userLevelProjectDir } from "./init-layout.js";

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

// List the .backlog.migrated-YYYY-MM-DD/ siblings under a project root,
// most recent first. Used by rollback to find what's restorable.
//   in_repo source  (rollback target = <root>/.backlog/, so look at <root>/)
//   user_level dest (rollback source archive sits at <user-level dir>.migrated-…)
function listMigrationArchives(searchRoot: string, baseName: string): string[] {
  const parent = path.dirname(searchRoot);
  if (!fs.existsSync(parent)) return [];
  const prefix = `${baseName}.migrated-`;
  return fs
    .readdirSync(parent)
    .filter((entry) => entry.startsWith(prefix))
    .map((entry) => path.join(parent, entry))
    .filter((entry) => fs.existsSync(path.join(entry, "config.toml")))
    .sort()
    .reverse();
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

  const newRoot = userLevelProjectDir(newName);
  if (fs.existsSync(path.join(newRoot, "config.toml"))) {
    throw new Error(`Target ${newRoot} already has a Backlog project. Move or remove it first.`);
  }

  copyDirContents(oldBacklogDir, newRoot);

  const migrated = loadConfig(newRoot);
  migrated.project_location = "user_level";
  if (newName !== migrated.project_name) migrated.project_name = newName;
  saveConfig(newRoot, migrated);

  // Archive the old in_repo .backlog/ first so we can record archived_at
  // in the migration history.
  let archivedAt: string | undefined;
  if (!options.keepOld) {
    archivedAt = `${oldBacklogDir}.migrated-${todayUtcDate()}`;
    fs.renameSync(oldBacklogDir, archivedAt);
  }

  const migrationRecord: ProjectMigrationRecord = {
    previous_path: oldRoot,
    previous_location: "in_repo",
    ...(archivedAt ? { archived_at: archivedAt } : {}),
    migrated_at: new Date().toISOString(),
  };

  const registry = loadRegistry(options.registryOptions);
  const idx = registry.projects.findIndex((p) => p.id === entry.id);
  const updatedEntry: ProjectRegistryEntry = {
    ...entry,
    path: newRoot,
    name: newName,
    location: "user_level",
    last_opened_at: new Date().toISOString(),
    migration_history: [...(entry.migration_history ?? []), migrationRecord],
  };
  if (idx >= 0) {
    registry.projects[idx] = updatedEntry;
    saveRegistry(registry, options.registryOptions);
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

  // Archive first so we can record archived_at in the migration history.
  let archivedAt: string | undefined;
  if (!options.keepOld) {
    archivedAt = `${oldRoot}.migrated-${todayUtcDate()}`;
    fs.renameSync(oldRoot, archivedAt);
  }

  const migrationRecord: ProjectMigrationRecord = {
    previous_path: oldRoot,
    previous_location: "user_level",
    ...(archivedAt ? { archived_at: archivedAt } : {}),
    migrated_at: new Date().toISOString(),
  };

  const registry = loadRegistry(options.registryOptions);
  const idx = registry.projects.findIndex((p) => p.id === entry.id);
  const updatedEntry: ProjectRegistryEntry = {
    ...entry,
    path: newRoot,
    location: "in_repo",
    last_opened_at: new Date().toISOString(),
    migration_history: [...(entry.migration_history ?? []), migrationRecord],
  };
  if (idx >= 0) {
    registry.projects[idx] = updatedEntry;
    saveRegistry(registry, options.registryOptions);
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

export interface RollbackOptions {
  // Project to roll back, identified by id/path/name. Rollback restores
  // the most recent .migrated-YYYY-MM-DD/ archive sibling.
  identifier: string;
  // If provided, restore this specific archive path instead of the most
  // recent one. Useful if multiple migrations have happened.
  archivePath?: string;
  // If true, leave the current workspace as a `.rolled-back-YYYY-MM-DD`
  // archive instead of removing it. Default is to remove (the rollback
  // is meant to be the inverse of the migration).
  keepCurrent?: boolean;
  registryOptions?: RegistryOptions;
}

export interface RollbackResult {
  // Where the workspace ended up living after rollback.
  restoredRoot: string;
  restoredBacklogDir: string;
  // The archive that fed the rollback (now consumed/empty).
  restoredFrom: string;
  // If the current workspace was kept (keepCurrent: true), this is its
  // post-rename path. Otherwise undefined.
  rolledBackTo?: string;
  entry: ProjectRegistryEntry;
  reposToReinstallHooksOn: RepoConfig[];
}

// Roll back the most recent migration of a project. Pops the last entry
// from registry.entry.migration_history, moves the archive back to where
// it came from, and updates the registry. The current workspace is
// removed unless keepCurrent is set.
//
// We rely on migration_history (rather than scanning siblings) because
// the migration's source dir isn't always reachable from configured repo
// paths — e.g. an in_repo project root that's a parent of all repos but
// isn't itself a configured repo would be invisible to a heuristic scan.
export function rollbackProjectMigration(options: RollbackOptions): RollbackResult {
  const entry = findRegistryEntry(options.identifier, options.registryOptions);
  if (!entry) {
    throw new Error(`No registered project matching: ${options.identifier}`);
  }
  const currentRoot = path.resolve(entry.path);
  const currentBacklogDir = entry.location === "in_repo" ? path.join(currentRoot, ".backlog") : currentRoot;
  if (!fs.existsSync(path.join(currentBacklogDir, "config.toml"))) {
    throw new Error(`Current project at ${currentBacklogDir} has no config.toml.`);
  }

  const history = entry.migration_history ?? [];
  const lastMigration = history[history.length - 1];

  // Pick the archive: explicit override → last history record's
  // archived_at → fail.
  let archivePath: string | undefined;
  if (options.archivePath) {
    archivePath = path.resolve(options.archivePath);
    if (!fs.existsSync(path.join(archivePath, "config.toml"))) {
      throw new Error(`No config.toml at archive ${archivePath}.`);
    }
  } else if (lastMigration?.archived_at && fs.existsSync(path.join(lastMigration.archived_at, "config.toml"))) {
    archivePath = lastMigration.archived_at;
  }

  if (!archivePath) {
    if (history.length === 0) {
      throw new Error(
        `Project ${entry.id} has no migration history to roll back. Pass --archive-path if you have an archive stashed elsewhere.`,
      );
    }
    throw new Error(
      `Last migration of ${entry.id} was archived at ${lastMigration?.archived_at ?? "(none)"} but that path no longer exists. Pass --archive-path explicitly.`,
    );
  }

  // Where to restore: explicit history record → derived from archive name.
  const archiveBaseMatch = path.basename(archivePath).match(/^(.+)\.migrated-\d{4}-\d{2}-\d{2}$/);
  if (!archiveBaseMatch) {
    throw new Error(
      `Archive ${archivePath} doesn't match the expected .migrated-YYYY-MM-DD/ shape; refusing to guess destination.`,
    );
  }
  const restoredBacklogDir = lastMigration
    ? (lastMigration.previous_location === "in_repo"
        ? path.join(lastMigration.previous_path, ".backlog")
        : lastMigration.previous_path)
    : path.join(path.dirname(archivePath), archiveBaseMatch[1]!);

  if (fs.existsSync(restoredBacklogDir)) {
    throw new Error(
      `Cannot restore: ${restoredBacklogDir} already exists. Move it out of the way first.`,
    );
  }

  fs.mkdirSync(path.dirname(restoredBacklogDir), { recursive: true });
  fs.renameSync(archivePath, restoredBacklogDir);

  const restoredConfig = loadConfig(restoredBacklogDir);
  const restoredLocation = restoredConfig.project_location;
  const restoredRoot = lastMigration?.previous_path
    ?? (restoredLocation === "in_repo" ? path.dirname(restoredBacklogDir) : restoredBacklogDir);

  // Update registry: rewrite the entry to its pre-migration state and pop
  // the history entry we just consumed.
  const registry = loadRegistry(options.registryOptions);
  const idx = registry.projects.findIndex((p) => p.id === entry.id);
  const updatedEntry: ProjectRegistryEntry = {
    ...entry,
    path: restoredRoot,
    name: restoredConfig.project_name,
    location: restoredLocation,
    last_opened_at: new Date().toISOString(),
    migration_history: history.slice(0, -1),
  };
  if (idx >= 0) {
    registry.projects[idx] = updatedEntry;
    saveRegistry(registry, options.registryOptions);
  }

  // Dispose the current workspace.
  let rolledBackTo: string | undefined;
  if (options.keepCurrent) {
    rolledBackTo = `${currentBacklogDir}.rolled-back-${todayUtcDate()}`;
    fs.renameSync(currentBacklogDir, rolledBackTo);
  } else {
    fs.rmSync(currentBacklogDir, { recursive: true, force: true });
  }

  return {
    restoredRoot,
    restoredBacklogDir,
    restoredFrom: archivePath,
    ...(rolledBackTo ? { rolledBackTo } : {}),
    entry: updatedEntry,
    reposToReinstallHooksOn: restoredConfig.repos,
  };
}
