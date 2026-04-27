import path from "node:path";
import { Command } from "commander";
import {
  getRegistryPath,
  listRegisteredProjects,
  registerProject,
  unregisterProject,
} from "@backlog/config";

export function registerProjectCommand(program: Command): void {
  const project = program.command("project").description("Manage the user-level registry of known Backlog projects");

  project
    .command("add")
    .description("Register a project path in the user registry")
    .argument("[path]", "Project root (defaults to current directory)")
    .action((rawPath?: string) => {
      const projectRoot = path.resolve(rawPath ?? process.cwd());
      const entry = registerProject({ projectRoot });
      console.log(`Registered ${entry.id} (${entry.name}) → ${entry.path}`);
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
        console.log(`${entry.id} | ${entry.name} | ${entry.path}${lastOpened}`);
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
}
