import fs from "node:fs";
import path from "node:path";
import { Command, Option } from "commander";
import { findProject, loadConfig } from "@backlog/config";
import { detectGitDir, repoCurrentBranch, repoIsDirty } from "@backlog/git";
import { inspectPreCommitHook } from "@backlog/hooks";
import { repoCheckoutPath } from "@backlog/schemas";

/**
 * `outdated` is its own state, not a flavour of `managed`: the hook carries a
 * version, and a stale one is installed, pointing at the right binary, and
 * still wrong — a version-2 hook refuses an execution agent's commit with a
 * message it cannot recognise. The fix is `backlog hooks install`.
 */
function hookLabel(hook: { exists: boolean; managed: boolean; pointsToBacklogBin: boolean; upToDate: boolean }): string {
  if (!hook.exists) return "missing";
  if (!hook.managed || !hook.pointsToBacklogBin) return "needs_attention";
  return hook.upToDate ? "managed" : "outdated";
}

export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description("Validate Backlog project health")
    .option("--repository <id>", "Only inspect one configured repository")
    .addOption(new Option("--repo <id>", "Only inspect one configured repository").hideHelp())
    .option("--json", "Emit machine-readable JSON")
    .action(async (options: { repo?: string; json?: boolean }) => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }

      const requiredPaths = [
        path.join(workspace.backlogDir, "config.toml"),
        path.join(workspace.backlogDir, "tasks.yaml"),
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
        throw new Error(`Unknown repository: ${options.repo}`);
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
          upToDate: boolean;
          installedVersion?: string;
        };
      }> = [];
      for (const repo of config.repos.filter((candidate) => !options.repo || candidate.id === options.repo)) {
        const checkoutPath = repoCheckoutPath(repo);
        if (!checkoutPath) {
          repos.push({
            id: repo.id,
            path: "",
            enabled: repo.enabled,
            defaultBranch: repo.default_branch,
            exists: false,
          });
          warnings.push(`repository_has_no_local_checkout:${repo.id}`);
          continue;
        }
        const exists = fs.existsSync(checkoutPath);
        if (!exists) {
          throw new Error(`Configured repository path does not exist: ${checkoutPath}`);
        }
        let branch: string | undefined;
        try {
          branch = await repoCurrentBranch(checkoutPath);
        } catch {
          branch = undefined;
          warnings.push(`cannot_read_branch:${repo.id}`);
        }
        let dirty: boolean | undefined;
        try {
          dirty = await repoIsDirty(checkoutPath);
        } catch {
          dirty = undefined;
          warnings.push(`cannot_read_dirty_state:${repo.id}`);
        }
        let hook:
          | { exists: boolean; managed: boolean; pointsToBacklogBin: boolean; upToDate: boolean; installedVersion?: string }
          | undefined;
        try {
          const gitDir = await detectGitDir(checkoutPath);
          // `expected` is what makes `upToDate` computable at all — without it
          // `inspectPreCommitHook` cannot re-render the script to compare
          // against, and every managed hook reads as healthy however old it is.
          // Doctor is what a user runs after upgrading, and a pre-version-3
          // hook is precisely what blocks that user's agent commits.
          const hookStatus = inspectPreCommitHook(gitDir, backlogBin, {
            projectRoot: workspace.root,
            backlogDir: workspace.backlogDir,
          });
          hook = {
            exists: hookStatus.exists,
            managed: hookStatus.managed,
            pointsToBacklogBin: hookStatus.pointsToBacklogBin,
            upToDate: hookStatus.upToDate,
            ...(hookStatus.installedVersion ? { installedVersion: hookStatus.installedVersion } : {}),
          };
          if (hookStatus.exists && (!hookStatus.managed || !hookStatus.pointsToBacklogBin)) {
            warnings.push(`hook_needs_attention:${repo.id}`);
          } else if (hookStatus.exists && !hookStatus.upToDate) {
            warnings.push(`hook_outdated:${repo.id}`);
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
          path: checkoutPath,
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
        project: config.project_name,
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
      console.log(`- project: ${config.project_name}`);
      console.log(`- mode: ${config.project_mode}`);
      console.log(`- repositories: ${config.repos.length}`);
      console.log(`- shim: ${path.join(workspace.backlogDir, "bin", "backlog")}`);
      for (const repo of repos) {
        const hookText = repo.hook ? ` hook=${hookLabel(repo.hook)}` : "";
        const branchText = repo.branch ? ` branch=${repo.branch}` : "";
        const defaultText = ` default=${repo.defaultBranch}`;
        const dirtyText = repo.dirty !== undefined ? ` dirty=${repo.dirty}` : "";
        const enabledText = ` enabled=${repo.enabled}`;
        const mismatchText = repo.branchMatchesDefault === false ? " branch_mismatch=true" : "";
        console.log(`- repository ${repo.id}: ${repo.path}${enabledText}${branchText}${defaultText}${dirtyText}${mismatchText}${hookText}`);
      }
      if (warnings.length > 0) {
        console.log(`- warnings: ${warnings.join(", ")}`);
      }
      console.log(warnings.length === 0 ? "Healthy" : "Healthy with warnings");
    });
}
