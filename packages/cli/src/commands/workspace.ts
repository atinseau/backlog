import path from "node:path";
import { Command } from "commander";
import {
  getRegistryPath,
  listRegisteredWorkspaces,
  registerWorkspace,
  unregisterWorkspace,
} from "@backlog/config";

export function registerWorkspaceCommand(program: Command): void {
  const workspace = program.command("workspace").description("Manage the user-level registry of known Backlog workspaces");

  workspace
    .command("add")
    .description("Register a workspace path in the user registry")
    .argument("[path]", "Workspace root (defaults to current directory)")
    .action((rawPath?: string) => {
      const workspaceRoot = path.resolve(rawPath ?? process.cwd());
      const entry = registerWorkspace({ workspaceRoot });
      console.log(`Registered ${entry.id} (${entry.name}) → ${entry.path}`);
    });

  workspace
    .command("list")
    .description("List registered workspaces")
    .option("--json", "Emit machine-readable JSON")
    .action((options: { json?: boolean }) => {
      const entries = listRegisteredWorkspaces();
      if (options.json) {
        console.log(JSON.stringify(entries, null, 2));
        return;
      }
      if (entries.length === 0) {
        console.log("No workspaces registered.");
        console.log(`Registry: ${getRegistryPath()}`);
        return;
      }
      for (const entry of entries) {
        const lastOpened = entry.last_opened_at ? ` last_opened=${entry.last_opened_at}` : "";
        console.log(`${entry.id} | ${entry.name} | ${entry.path}${lastOpened}`);
      }
    });

  workspace
    .command("remove")
    .description("Remove a workspace from the registry (does not delete .backlog/)")
    .argument("<id-or-path>", "Workspace id (WS-…) or absolute path")
    .action((idOrPath: string) => {
      const removed = unregisterWorkspace(idOrPath);
      if (!removed) {
        throw new Error(`No registered workspace matching: ${idOrPath}`);
      }
      console.log(`Unregistered ${removed.id} (${removed.name})`);
    });

  workspace
    .command("path")
    .description("Print the registry file location")
    .action(() => {
      console.log(getRegistryPath());
    });
}
