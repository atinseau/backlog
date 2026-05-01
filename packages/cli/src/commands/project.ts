import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";
import { Command } from "commander";
import {
  generateProjectId,
  getRegistryPath,
  listRegisteredProjects,
  loadConfig,
  migrateProjectToInRepo,
  migrateProjectToUserLevel,
  registerProject,
  rollbackProjectMigration,
  saveConfig,
  unregisterProject,
  userLevelProjectDir,
} from "@backlog/config";
import { detectGitDir } from "@backlog/git";
import { installPreCommitHook } from "@backlog/hooks";

interface ProjectExportManifest {
  manifest_version: 1;
  exported_at: string;
  project_id: string;
  project_name: string;
  location: "in_repo" | "user_level";
  cli_version_at_export: string;
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
    .option("--keep-old", "Don't rename the old project data dir to .migrated-…/")
    .action(async (idOrPathOrName: string, options: { to: string; name?: string; into?: string; keepOld?: boolean }) => {
      const targetLocation = options.to.replace(/-/g, "_");
      if (targetLocation !== "user_level" && targetLocation !== "in_repo") {
        throw new Error(`--to must be 'user-level' or 'in-repo' (got ${options.to}).`);
      }

      // The state-mutation half (copy, config, registry, archive) lives in
      // @backlog/config so it can be unit-tested without spinning up real
      // git dirs. Hook reinstall stays here because @backlog/hooks isn't a
      // dependency of @backlog/config.
      const result =
        targetLocation === "user_level"
          ? migrateProjectToUserLevel({
              identifier: idOrPathOrName,
              ...(options.name !== undefined ? { newName: options.name } : {}),
              ...(options.keepOld ? { keepOld: true } : {}),
            })
          : ((): ReturnType<typeof migrateProjectToInRepo> => {
              if (!options.into) {
                throw new Error("Migrating to in_repo requires --into <repo-id> (the repo that will host .backlog/).");
              }
              return migrateProjectToInRepo({
                identifier: idOrPathOrName,
                intoRepoId: options.into,
                ...(options.keepOld ? { keepOld: true } : {}),
              });
            })();

      console.log(`Migrating ${result.entry.id} (${result.entry.name}) → ${result.newBacklogDir}`);

      const backlogBin = path.join(result.newBacklogDir, "bin", "backlog");
      const reinstallReport: { repoId: string; status: "ok" | "failed"; detail?: string }[] = [];
      for (const repo of result.reposToReinstallHooksOn) {
        try {
          const gitDir = await detectGitDir(repo.path);
          installPreCommitHook({
            gitDir,
            backlogBin,
            projectRoot: result.newRoot,
            backlogDir: result.newBacklogDir,
            force: true, // Existing hooks point at the OLD path; always rewrite.
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

      console.log(`✓ Migrated to ${result.newBacklogDir}`);
      console.log(`  registry: updated`);
      if (result.reposToReinstallHooksOn.length > 0) {
        console.log(`  hooks:`);
        for (const r of reinstallReport) {
          const detail = r.detail ? ` — ${r.detail}` : "";
          console.log(`    ${r.repoId}: ${r.status}${detail}`);
        }
      }
      if (result.archivedAt) {
        console.log(`  archived old project data: ${result.archivedAt}`);
      }
      const failed = reinstallReport.filter((r) => r.status === "failed");
      if (failed.length > 0) {
        console.log("");
        console.log("Some hooks could not be reinstalled. Run `backlog hooks install --all --force` from the new project dir to retry.");
      }
    });

  project
    .command("migrate-rollback")
    .description("Restore a project's most recent .migrated-…/ archive (inverse of `project migrate`)")
    .argument("<id-or-name-or-path>", "Project to roll back")
    .option("--archive-path <path>", "Specific archive to restore (defaults to the most recent sibling)")
    .option("--keep-current", "Don't delete the current project data; rename it to .rolled-back-…/ instead")
    .action(async (idOrPathOrName: string, options: { archivePath?: string; keepCurrent?: boolean }) => {
      const result = rollbackProjectMigration({
        identifier: idOrPathOrName,
        ...(options.archivePath !== undefined ? { archivePath: options.archivePath } : {}),
        ...(options.keepCurrent ? { keepCurrent: true } : {}),
      });

      console.log(`Rolled back ${result.entry.id} (${result.entry.name})`);
      console.log(`  restored: ${result.restoredBacklogDir} (${result.entry.location})`);
      console.log(`  from:     ${result.restoredFrom}`);

      const backlogBin = path.join(result.restoredBacklogDir, "bin", "backlog");
      const reinstallReport: { repoId: string; status: "ok" | "failed"; detail?: string }[] = [];
      for (const repo of result.reposToReinstallHooksOn) {
        try {
          const gitDir = await detectGitDir(repo.path);
          installPreCommitHook({
            gitDir,
            backlogBin,
            projectRoot: result.restoredRoot,
            backlogDir: result.restoredBacklogDir,
            force: true,
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
      if (result.reposToReinstallHooksOn.length > 0) {
        console.log(`  hooks:`);
        for (const r of reinstallReport) {
          const detail = r.detail ? ` — ${r.detail}` : "";
          console.log(`    ${r.repoId}: ${r.status}${detail}`);
        }
      }
      if (result.rolledBackTo) {
        console.log(`  current project data archived to: ${result.rolledBackTo}`);
      }
      const failed = reinstallReport.filter((r) => r.status === "failed");
      if (failed.length > 0) {
        console.log("");
        console.log("Some hooks could not be reinstalled. Run `backlog hooks install --all --force` from the restored project dir to retry.");
      }
    });

  project
    .command("export")
    .description("Bundle a project's data dir into a tar.gz for backup or transfer")
    .argument("<id-or-name-or-path>", "Project to export")
    .requiredOption("--to <file>", "Path to write the .tar.gz archive")
    .action(async (idOrPathOrName: string, options: { to: string }) => {
      const target = path.isAbsolute(idOrPathOrName) ? path.resolve(idOrPathOrName) : idOrPathOrName;
      const entry = listRegisteredProjects().find(
        (p) => p.id === idOrPathOrName || p.path === target || p.name === idOrPathOrName,
      );
      if (!entry) throw new Error(`No registered project matching: ${idOrPathOrName}`);

      const backlogDir = entry.location === "in_repo" ? path.join(entry.path, ".backlog") : entry.path;
      const config = loadConfig(backlogDir);

      // Stage everything in a temp dir, then tar from there. Lets us
      // include a manifest at the archive root without polluting the
      // user's project.
      const stage = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "backlog-export-")));
      try {
        const projectCopy = path.join(stage, "project");
        fs.cpSync(backlogDir, projectCopy, { recursive: true, dereference: false });

        const manifest: ProjectExportManifest = {
          manifest_version: 1,
          exported_at: new Date().toISOString(),
          project_id: entry.id,
          project_name: config.project_name,
          location: entry.location,
          cli_version_at_export: process.env.BACKLOG_VERSION ?? "dev",
        };
        fs.writeFileSync(
          path.join(stage, "manifest.json"),
          JSON.stringify(manifest, null, 2) + "\n",
          "utf8",
        );

        const archivePath = path.resolve(options.to);
        fs.mkdirSync(path.dirname(archivePath), { recursive: true });
        // -C cd into stage so the archive has manifest.json + project/ at the root.
        await execa("tar", ["-czf", archivePath, "-C", stage, "manifest.json", "project"]);

        console.log(`✓ Exported ${entry.id} (${config.project_name}) → ${archivePath}`);
        const size = fs.statSync(archivePath).size;
        console.log(`  size: ${(size / 1024).toFixed(1)} KiB`);
      } finally {
        fs.rmSync(stage, { recursive: true, force: true });
      }
    });

  project
    .command("import")
    .description("Restore a project from a tar.gz produced by `project export`")
    .argument("<file>", "Path to the .tar.gz archive")
    .option("--name <name>", "Override the project name (and the user-level slug) on import")
    .option("--into <path>", "Where to restore. Defaults to ~/.backlog/<slug>/ for user_level imports.")
    .action(async (file: string, options: { name?: string; into?: string }) => {
      const archive = path.resolve(file);
      if (!fs.existsSync(archive)) throw new Error(`Archive not found: ${archive}`);

      const stage = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "backlog-import-")));
      try {
        await execa("tar", ["-xzf", archive, "-C", stage]);
        const manifestPath = path.join(stage, "manifest.json");
        if (!fs.existsSync(manifestPath)) {
          throw new Error("Archive doesn't contain manifest.json — not a backlog export.");
        }
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as ProjectExportManifest;
        if (manifest.manifest_version !== 1) {
          throw new Error(`Unsupported export manifest_version: ${manifest.manifest_version}`);
        }
        const projectCopy = fs.existsSync(path.join(stage, "project"))
          ? path.join(stage, "project")
          : path.join(stage, "workspace");
        if (!fs.existsSync(path.join(projectCopy, "config.toml"))) {
          throw new Error("Archive's project/ has no config.toml — corrupt export.");
        }

        const targetName = options.name ?? manifest.project_name;
        // Compute destination based on the archive's recorded location
        // unless --into overrides. For in_repo we require --into (the
        // original path probably doesn't exist on the new machine).
        let destBacklogDir: string;
        let destProjectRoot: string;
        if (options.into) {
          const into = path.resolve(options.into);
          if (manifest.location === "in_repo") {
            destProjectRoot = into;
            destBacklogDir = path.join(into, ".backlog");
          } else {
            destBacklogDir = into;
            destProjectRoot = into;
          }
        } else if (manifest.location === "user_level") {
          destBacklogDir = userLevelProjectDir(targetName);
          destProjectRoot = destBacklogDir;
        } else {
          throw new Error(
            "in_repo imports require --into <path-to-host-repo> (the archive doesn't carry a portable host path).",
          );
        }

        if (fs.existsSync(path.join(destBacklogDir, "config.toml"))) {
          throw new Error(`Destination already has a project: ${destBacklogDir}`);
        }
        fs.mkdirSync(destBacklogDir, { recursive: true });
        fs.cpSync(projectCopy, destBacklogDir, { recursive: true });

        // If the original project_id is already in the registry (e.g.
        // re-importing a project on the same machine, or a clone for a
        // colleague), regenerate so the import is a sibling, not a
        // silent replacement of the live entry.
        const idCollision = listRegisteredProjects().some((p) => p.id === manifest.project_id);
        if (idCollision) {
          const config = loadConfig(destBacklogDir);
          config.project_id = generateProjectId();
          saveConfig(destBacklogDir, config);
        }

        // Block name collision (user_level only) before we register —
        // same guard as init. After --name disambiguation if needed.
        if (manifest.location === "user_level") {
          const collision = listRegisteredProjects().find(
            (p) => p.location === "user_level" && p.name === targetName && p.path !== destBacklogDir,
          );
          if (collision) {
            throw new Error(
              `A user-level project named "${targetName}" is already registered (id=${collision.id}). Pass --name to disambiguate.`,
            );
          }
          // Apply the rename if --name differs from the archive value.
          if (targetName !== manifest.project_name) {
            const config = loadConfig(destBacklogDir);
            config.project_name = targetName;
            saveConfig(destBacklogDir, config);
          }
        }

        const registered = registerProject({ projectRoot: destProjectRoot, location: manifest.location });
        console.log(`✓ Imported ${registered.id} (${registered.name}) → ${destBacklogDir} [${manifest.location}]`);
        console.log(`  exported_at: ${manifest.exported_at}`);
        console.log(
          "  hooks: not installed yet — run `backlog hooks install --all` from the restored project dir.",
        );
      } finally {
        fs.rmSync(stage, { recursive: true, force: true });
      }
    });
}
