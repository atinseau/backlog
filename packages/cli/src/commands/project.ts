import path from "node:path";
import { Command } from "commander";
import {
  getRegistryPath,
  listRegisteredProjects,
  migrateProjectToInRepo,
  migrateProjectToUserLevel,
  registerProject,
  unregisterProject,
} from "@backlog/config";
import { detectGitDir } from "@backlog/git";
import { installPreCommitHook } from "@backlog/hooks";

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
        console.log(`  archived old workspace: ${result.archivedAt}`);
      }
      const failed = reinstallReport.filter((r) => r.status === "failed");
      if (failed.length > 0) {
        console.log("");
        console.log("Some hooks could not be reinstalled. Run `backlog hooks install --all --force` from the new workspace dir to retry.");
      }
    });
}
