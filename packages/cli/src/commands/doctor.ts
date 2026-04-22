import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { findWorkspace, loadConfig } from "@cockpit-ai/config";

export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description("Validate Cockpit workspace health")
    .action(() => {
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .cockpit workspace found. Run `cockpit init` first.");
      }

      const requiredPaths = [
        path.join(workspace.cockpitDir, "config.toml"),
        path.join(workspace.cockpitDir, "work-items.yaml"),
        path.join(workspace.cockpitDir, "tasks.yaml"),
        path.join(workspace.cockpitDir, "sources.yaml"),
        path.join(workspace.cockpitDir, "sync-conflicts.json"),
        path.join(workspace.cockpitDir, "agents.yaml"),
        path.join(workspace.cockpitDir, "bin", "cockpit"),
      ];

      for (const requiredPath of requiredPaths) {
        if (!fs.existsSync(requiredPath)) {
          throw new Error(`Missing required path: ${requiredPath}`);
        }
      }

      const config = loadConfig(workspace.cockpitDir);
      for (const repo of config.repos) {
        if (!fs.existsSync(repo.path)) {
          throw new Error(`Configured repo path does not exist: ${repo.path}`);
        }
      }

      console.log("Cockpit doctor");
      console.log(`- workspace: ${config.workspace_name}`);
      console.log(`- mode: ${config.workspace_mode}`);
      console.log(`- repos: ${config.repos.length}`);
      console.log(`- shim: ${path.join(workspace.cockpitDir, "bin", "cockpit")}`);
      console.log("Healthy");
    });
}
