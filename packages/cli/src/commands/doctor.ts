import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { findWorkspace, loadConfig } from "@cockpit-ai/config";
import { repoCurrentBranch } from "@cockpit-ai/git";

export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description("Validate Cockpit workspace health")
    .option("--json", "Emit machine-readable JSON")
    .action(async (options: { json?: boolean }) => {
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
      const warnings: string[] = [];
      const repos: Array<{ id: string; path: string; exists: boolean; branch?: string }> = [];
      for (const repo of config.repos) {
        const exists = fs.existsSync(repo.path);
        if (!exists) {
          throw new Error(`Configured repo path does not exist: ${repo.path}`);
        }
        let branch: string | undefined;
        try {
          branch = await repoCurrentBranch(repo.path);
        } catch {
          branch = undefined;
          warnings.push(`cannot_read_branch:${repo.id}`);
        }
        repos.push({
          id: repo.id,
          path: repo.path,
          exists,
          ...(branch ? { branch } : {}),
        });
      }
      if (config.repos.length === 0) {
        warnings.push("no_repos_configured");
      }

      const payload = {
        workspace: config.workspace_name,
        mode: config.workspace_mode,
        repoCount: config.repos.length,
        shim: path.join(workspace.cockpitDir, "bin", "cockpit"),
        warnings,
        repos,
      };

      if (options.json) {
        console.log(JSON.stringify(payload, null, 2));
        return;
      }

      console.log("Cockpit doctor");
      console.log(`- workspace: ${config.workspace_name}`);
      console.log(`- mode: ${config.workspace_mode}`);
      console.log(`- repos: ${config.repos.length}`);
      console.log(`- shim: ${path.join(workspace.cockpitDir, "bin", "cockpit")}`);
      for (const repo of repos) {
        console.log(`- repo ${repo.id}: ${repo.path}${repo.branch ? ` (${repo.branch})` : ""}`);
      }
      if (warnings.length > 0) {
        console.log(`- warnings: ${warnings.join(", ")}`);
      }
      console.log(warnings.length === 0 ? "Healthy" : "Healthy with warnings");
    });
}
