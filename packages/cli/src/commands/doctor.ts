import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { findProject, loadConfig } from "@backlog/config";
import { detectGitDir, repoCurrentBranch, repoIsDirty } from "@backlog/git";
import { inspectPreCommitHook } from "@backlog/hooks";

export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description("Validate Backlog workspace health")
    .option("--repo <id>", "Only inspect one configured repo")
    .option("--json", "Emit machine-readable JSON")
    .action(async (options: { repo?: string; json?: boolean }) => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }

      const requiredPaths = [
        path.join(workspace.backlogDir, "config.toml"),
        path.join(workspace.backlogDir, "work-items.yaml"),
        path.join(workspace.backlogDir, "subtasks.yaml"),
        path.join(workspace.backlogDir, "sources.yaml"),
        path.join(workspace.backlogDir, "sync-conflicts.json"),
        path.join(workspace.backlogDir, "agents.yaml"),
        path.join(workspace.backlogDir, "bin", "backlog"),
      ];

      for (const requiredPath of requiredPaths) {
        if (!fs.existsSync(requiredPath)) {
          throw new Error(`Missing required path: ${requiredPath}`);
        }
      }

      const config = loadConfig(workspace.backlogDir);
      if (options.repo && !config.repos.some((repo) => repo.id === options.repo)) {
        throw new Error(`Unknown repo: ${options.repo}`);
      }
      const warnings: string[] = [];
      const backlogBin = path.join(workspace.backlogDir, "bin", "backlog");
      const repos: Array<{
        id: string;
        path: string;
        enabled: boolean;
        defaultBranch: string;
        exists: boolean;
        branch?: string;
        branchMatchesDefault?: boolean;
        dirty?: boolean;
        hook?: {
          exists: boolean;
          managed: boolean;
          pointsToBacklogBin: boolean;
        };
      }> = [];
      for (const repo of config.repos.filter((candidate) => !options.repo || candidate.id === options.repo)) {
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
        let dirty: boolean | undefined;
        try {
          dirty = await repoIsDirty(repo.path);
        } catch {
          dirty = undefined;
          warnings.push(`cannot_read_dirty_state:${repo.id}`);
        }
        let hook: { exists: boolean; managed: boolean; pointsToBacklogBin: boolean } | undefined;
        try {
          const gitDir = await detectGitDir(repo.path);
          const hookStatus = inspectPreCommitHook(gitDir, backlogBin);
          hook = {
            exists: hookStatus.exists,
            managed: hookStatus.managed,
            pointsToBacklogBin: hookStatus.pointsToBacklogBin,
          };
          if (hookStatus.exists && (!hookStatus.managed || !hookStatus.pointsToBacklogBin)) {
            warnings.push(`hook_needs_attention:${repo.id}`);
          }
        } catch {
          warnings.push(`cannot_read_hook:${repo.id}`);
        }
        const branchMatchesDefault = branch ? branch === repo.default_branch : undefined;
        if (branchMatchesDefault === false) {
          warnings.push(`branch_differs_from_default:${repo.id}`);
        }
        repos.push({
          id: repo.id,
          path: repo.path,
          enabled: repo.enabled,
          defaultBranch: repo.default_branch,
          exists,
          ...(branch ? { branch } : {}),
          ...(branchMatchesDefault !== undefined ? { branchMatchesDefault } : {}),
          ...(dirty !== undefined ? { dirty } : {}),
          ...(hook ? { hook } : {}),
        });
      }
      if (config.repos.length === 0) {
        warnings.push("no_repos_configured");
      }

      const payload = {
        workspace: config.project_name,
        mode: config.project_mode,
        repoCount: config.repos.length,
        shim: path.join(workspace.backlogDir, "bin", "backlog"),
        warnings,
        repos,
      };

      if (options.json) {
        console.log(JSON.stringify(payload, null, 2));
        return;
      }

      console.log("Backlog doctor");
      console.log(`- workspace: ${config.project_name}`);
      console.log(`- mode: ${config.project_mode}`);
      console.log(`- repos: ${config.repos.length}`);
      console.log(`- shim: ${path.join(workspace.backlogDir, "bin", "backlog")}`);
      for (const repo of repos) {
        const hookText = repo.hook
          ? ` hook=${repo.hook.exists ? (repo.hook.managed && repo.hook.pointsToBacklogBin ? "managed" : "needs_attention") : "missing"}`
          : "";
        const branchText = repo.branch ? ` branch=${repo.branch}` : "";
        const defaultText = ` default=${repo.defaultBranch}`;
        const dirtyText = repo.dirty !== undefined ? ` dirty=${repo.dirty}` : "";
        const enabledText = ` enabled=${repo.enabled}`;
        const mismatchText = repo.branchMatchesDefault === false ? " branch_mismatch=true" : "";
        console.log(`- repo ${repo.id}: ${repo.path}${enabledText}${branchText}${defaultText}${dirtyText}${mismatchText}${hookText}`);
      }
      if (warnings.length > 0) {
        console.log(`- warnings: ${warnings.join(", ")}`);
      }
      console.log(warnings.length === 0 ? "Healthy" : "Healthy with warnings");
    });
}
