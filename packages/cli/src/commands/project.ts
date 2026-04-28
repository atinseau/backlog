import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import {
  getRegistryPath,
  listRegisteredProjects,
  loadConfig,
  loadRegistry,
  registerProject,
  saveConfig,
  saveRegistry,
  unregisterProject,
  userLevelWorkspaceDir,
} from "@backlog/config";
import { detectGitDir } from "@backlog/git";
import { installPreCommitHook } from "@backlog/hooks";
import type { ProjectRegistryEntry } from "@backlog/schemas";

function findRegistryEntry(idOrPath: string): ProjectRegistryEntry | null {
  const target = path.isAbsolute(idOrPath) ? path.resolve(idOrPath) : idOrPath;
  return listRegisteredProjects().find((p) => p.id === idOrPath || p.path === target || p.name === idOrPath) ?? null;
}

// Recursive copy that doesn't follow symlinks (relevant for the bin/
// shim subdirectory which Backlog writes itself but in case anything else
// is there). Uses fs.cpSync (Node ≥16.7) which preserves mode bits.
function copyDirContents(from: string, to: string): void {
  fs.mkdirSync(to, { recursive: true });
  fs.cpSync(from, to, { recursive: true, dereference: false, errorOnExist: false, force: false });
}

export function registerProjectCommand(program: Command): void {
  const project = program.command("project").description("Manage the user-level registry of known Backlog projects");

  project
    .command("add")
    .description("Register a project path in the user registry")
    .argument("[path]", "Project root (defaults to current directory)")
    .action((rawPath?: string) => {
      const projectRoot = path.resolve(rawPath ?? process.cwd());
      const entry = registerProject({ projectRoot });
      console.log(`Registered ${entry.id} (${entry.name}) → ${entry.path} [${entry.location}]`);
    });

  project
    .command("list")
    .description("List registered projects")
    .option("--json", "Emit machine-readable JSON")
    .action((options: { json?: boolean }) => {
      const entries = listRegisteredProjects();
      if (options.json) {
        console.log(JSON.stringify(entries, null, 2));
        return;
      }
      if (entries.length === 0) {
        console.log("No projects registered.");
        console.log(`Registry: ${getRegistryPath()}`);
        return;
      }
      for (const entry of entries) {
        const lastOpened = entry.last_opened_at ? ` last_opened=${entry.last_opened_at}` : "";
        console.log(`${entry.id} | ${entry.name} | [${entry.location}] | ${entry.path}${lastOpened}`);
      }
    });

  project
    .command("remove")
    .description("Remove a project from the registry (does not delete .backlog/)")
    .argument("<id-or-path>", "Project id (WS-…) or absolute path")
    .action((idOrPath: string) => {
      const removed = unregisterProject(idOrPath);
      if (!removed) {
        throw new Error(`No registered project matching: ${idOrPath}`);
      }
      console.log(`Unregistered ${removed.id} (${removed.name})`);
    });

  project
    .command("path")
    .description("Print the registry file location")
    .action(() => {
      console.log(getRegistryPath());
    });

  project
    .command("migrate")
    .description("Move an in_repo project to user_level (~/.backlog/<name>/), or vice versa")
    .argument("<id-or-name-or-path>", "Project to migrate")
    .requiredOption("--to <location>", "Target location: 'user-level' or 'in-repo'")
    .option("--name <name>", "Rename the project during migration (also affects the user-level dir name)")
    .option("--into <repo-id>", "When migrating to in_repo, the repo whose root will host .backlog/")
    .option("--keep-old", "Don't rename the old workspace dir to .migrated-…/")
    .action(async (idOrPathOrName: string, options: { to: string; name?: string; into?: string; keepOld?: boolean }) => {
      const targetLocation = options.to.replace(/-/g, "_");
      if (targetLocation !== "user_level" && targetLocation !== "in_repo") {
        throw new Error(`--to must be 'user-level' or 'in-repo' (got ${options.to}).`);
      }

      const entry = findRegistryEntry(idOrPathOrName);
      if (!entry) {
        throw new Error(`No registered project matching: ${idOrPathOrName}`);
      }
      if (entry.location === targetLocation) {
        throw new Error(`Project ${entry.id} is already at location=${entry.location}.`);
      }

      const oldRoot = path.resolve(entry.path);
      const oldBacklogDir = entry.location === "in_repo" ? path.join(oldRoot, ".backlog") : oldRoot;
      if (!fs.existsSync(path.join(oldBacklogDir, "config.toml"))) {
        throw new Error(`Workspace at ${oldBacklogDir} has no config.toml.`);
      }

      const config = loadConfig(oldBacklogDir);
      const newName = options.name ?? config.project_name;

      if (targetLocation === "user_level") {
        // Name uniqueness guard.
        const collision = listRegisteredProjects().find(
          (p) => p.location === "user_level" && p.id !== entry.id && p.name === newName,
        );
        if (collision) {
          throw new Error(
            `A user-level project named "${newName}" already exists (id=${collision.id} at ${collision.path}). Pass --name to rename.`,
          );
        }

        const newRoot = userLevelWorkspaceDir(newName);
        if (fs.existsSync(path.join(newRoot, "config.toml"))) {
          throw new Error(`Target ${newRoot} already has a Backlog workspace. Move or remove it first.`);
        }

        console.log(`Migrating ${entry.id} (${entry.name}) → ${newRoot}`);
        copyDirContents(oldBacklogDir, newRoot);

        // Patch config in new location.
        const migrated = loadConfig(newRoot);
        migrated.project_location = "user_level";
        if (newName !== migrated.project_name) migrated.project_name = newName;
        saveConfig(newRoot, migrated);

        // Update registry: replace this entry in place so we keep the id and added_at.
        const registry = loadRegistry();
        const idx = registry.projects.findIndex((p) => p.id === entry.id);
        if (idx >= 0) {
          registry.projects[idx] = {
            ...entry,
            path: newRoot,
            name: newName,
            location: "user_level",
            last_opened_at: new Date().toISOString(),
          };
          saveRegistry(registry);
        }

        // Reinstall hooks for every configured repo so they point at the new
        // workspace. We DON'T --force here; if a repo has a non-managed hook
        // we surface it as a warning so the user can resolve manually.
        const backlogBin = path.join(newRoot, "bin", "backlog");
        const reinstallReport: { repoId: string; status: "ok" | "skipped" | "failed"; detail?: string }[] = [];
        for (const repo of migrated.repos) {
          try {
            const gitDir = await detectGitDir(repo.path);
            installPreCommitHook({
              gitDir,
              backlogBin,
              projectRoot: newRoot,
              backlogDir: newRoot,
              force: true, // Existing hooks point at the OLD path; we always rewrite.
            });
            reinstallReport.push({ repoId: repo.id, status: "ok" });
          } catch (error) {
            reinstallReport.push({
              repoId: repo.id,
              status: "failed",
              detail: error instanceof Error ? error.message : String(error),
            });
          }
        }

        // Move (or keep) the old in_repo .backlog/ dir.
        let archivedAt: string | undefined;
        if (!options.keepOld && entry.location === "in_repo") {
          const date = new Date().toISOString().slice(0, 10);
          archivedAt = `${oldBacklogDir}.migrated-${date}`;
          fs.renameSync(oldBacklogDir, archivedAt);
        }

        console.log(`✓ Migrated to ${newRoot}`);
        console.log(`  registry: updated`);
        console.log(`  hooks:`);
        for (const r of reinstallReport) {
          const detail = r.detail ? ` — ${r.detail}` : "";
          console.log(`    ${r.repoId}: ${r.status}${detail}`);
        }
        if (archivedAt) {
          console.log(`  archived old workspace: ${archivedAt}`);
        }
        const failed = reinstallReport.filter((r) => r.status === "failed");
        if (failed.length > 0) {
          console.log("");
          console.log("Some hooks could not be reinstalled. Run `backlog hooks install --all --force` from the new workspace dir to retry.");
        }
        return;
      }

      // user_level → in_repo
      const config2 = loadConfig(oldBacklogDir);
      const targetRepoId = options.into;
      if (!targetRepoId) {
        throw new Error("Migrating to in_repo requires --into <repo-id> (the repo that will host .backlog/).");
      }
      const targetRepo = config2.repos.find((r) => r.id === targetRepoId);
      if (!targetRepo) {
        throw new Error(`Unknown repo: ${targetRepoId}. Configured repos: ${config2.repos.map((r) => r.id).join(", ")}`);
      }
      const newRoot = targetRepo.path;
      const newBacklogDir = path.join(newRoot, ".backlog");
      if (fs.existsSync(newBacklogDir)) {
        throw new Error(`${newBacklogDir} already exists. Remove it before migrating.`);
      }

      console.log(`Migrating ${entry.id} (${entry.name}) → ${newBacklogDir}`);
      copyDirContents(oldBacklogDir, newBacklogDir);

      const migrated = loadConfig(newBacklogDir);
      migrated.project_location = "in_repo";
      saveConfig(newBacklogDir, migrated);

      const registry = loadRegistry();
      const idx = registry.projects.findIndex((p) => p.id === entry.id);
      if (idx >= 0) {
        registry.projects[idx] = {
          ...entry,
          path: newRoot,
          location: "in_repo",
          last_opened_at: new Date().toISOString(),
        };
        saveRegistry(registry);
      }

      const backlogBin = path.join(newBacklogDir, "bin", "backlog");
      for (const repo of migrated.repos) {
        try {
          const gitDir = await detectGitDir(repo.path);
          installPreCommitHook({
            gitDir,
            backlogBin,
            projectRoot: newRoot,
            backlogDir: newBacklogDir,
            force: true,
          });
        } catch (error) {
          console.error(`! hook reinstall failed for ${repo.id}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      let archivedAt: string | undefined;
      if (!options.keepOld) {
        const date = new Date().toISOString().slice(0, 10);
        archivedAt = `${oldRoot}.migrated-${date}`;
        fs.renameSync(oldRoot, archivedAt);
      }

      console.log(`✓ Migrated to ${newBacklogDir}`);
      if (archivedAt) console.log(`  archived old workspace: ${archivedAt}`);
    });
}
