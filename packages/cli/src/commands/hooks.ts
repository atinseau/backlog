import path from "node:path";
import { Command } from "commander";
import { findWorkspace, loadConfig } from "@backlog/config";
import { detectGitDir, detectRepoRoot } from "@backlog/git";
import { inspectPreCommitHook, installPreCommitHook, uninstallPreCommitHook } from "@backlog/hooks";

interface HookTarget {
  id: string;
  root: string;
}

async function resolveHookTargets(options: {
  repo?: string;
  repoRoot?: string;
  all?: boolean;
}): Promise<{ workspace: NonNullable<ReturnType<typeof findWorkspace>>; targets: HookTarget[] }> {
  const workspace = findWorkspace();
  if (!workspace) {
    throw new Error("No .backlog workspace found. Run `backlog init` first.");
  }
  const config = loadConfig(workspace.backlogDir);

  if (options.all) {
    if (options.repo || options.repoRoot) {
      throw new Error("Use --all by itself, without --repo or --repo-root.");
    }
    return {
      workspace,
      targets: config.repos.map((repo) => ({ id: repo.id, root: repo.path })),
    };
  }

  if (options.repo && options.repoRoot) {
    throw new Error("Use either --repo or --repo-root, not both.");
  }

  if (options.repo) {
    const repo = config.repos.find((candidate) => candidate.id === options.repo);
    if (!repo) {
      throw new Error(`Unknown repo: ${options.repo}`);
    }
    return {
      workspace,
      targets: [{ id: repo.id, root: repo.path }],
    };
  }

  const repoRoot = options.repoRoot ?? await detectRepoRoot();
  return {
    workspace,
    targets: [{ id: path.basename(repoRoot), root: repoRoot }],
  };
}

export function registerHooksCommand(program: Command): void {
  const hooks = program.command("hooks").description("Manage Backlog Git hooks");

  hooks
    .command("status")
    .description("Inspect Backlog-managed pre-commit hooks")
    .option("--repo <id>", "Target one configured repo by id")
    .option("--repo-root <path>", "Target repo root. Defaults to current git repo")
    .option("--all", "Inspect every configured repo in this workspace")
    .option("--json", "Emit machine-readable JSON")
    .action(async (options: { repo?: string; repoRoot?: string; all?: boolean; json?: boolean }) => {
      const { workspace, targets } = await resolveHookTargets(options);
      const backlogBin = path.join(workspace.backlogDir, "bin", "backlog");
      const statuses = [];
      for (const target of targets) {
        const gitDir = await detectGitDir(target.root);
        statuses.push({
          repoId: target.id,
          repoRoot: target.root,
          ...inspectPreCommitHook(gitDir, backlogBin),
        });
      }

      if (options.json) {
        console.log(JSON.stringify(options.all || options.repo ? statuses : statuses[0], null, 2));
        return;
      }

      for (const [index, status] of statuses.entries()) {
        if (statuses.length > 1) {
          if (index > 0) {
            console.log("");
          }
          console.log(`Repo: ${status.repoId}`);
          console.log(`Root: ${status.repoRoot}`);
        }
        console.log(`Hook: ${status.hookPath}`);
        console.log(`Exists: ${status.exists}`);
        console.log(`Managed: ${status.managed}`);
        if (status.backlogBin) {
          console.log(`Backlog bin: ${status.backlogBin}`);
        }
        console.log(`Points to local shim: ${status.pointsToBacklogBin}`);
      }
    });

  hooks
    .command("install")
    .description("Install Backlog-managed pre-commit hooks")
    .option("--repo <id>", "Target one configured repo by id")
    .option("--repo-root <path>", "Target repo root. Defaults to current git repo")
    .option("--all", "Install hooks in every configured repo in this workspace")
    .option("--force", "Replace an existing non-Backlog hook")
    .action(async (options: { repo?: string; repoRoot?: string; all?: boolean; force?: boolean }) => {
      const { workspace, targets } = await resolveHookTargets(options);
      const backlogBin = path.join(workspace.backlogDir, "bin", "backlog");
      for (const target of targets) {
        const gitDir = await detectGitDir(target.root);
        const hookPath = installPreCommitHook({
          gitDir,
          backlogBin,
          workspaceRoot: workspace.root,
          ...(options.force ? { force: true } : {}),
        });
        console.log(`Installed pre-commit hook for ${target.id} at ${hookPath}`);
      }
    });

  hooks
    .command("uninstall")
    .description("Remove Backlog-managed pre-commit hooks")
    .option("--repo <id>", "Target one configured repo by id")
    .option("--repo-root <path>", "Target repo root. Defaults to current git repo")
    .option("--all", "Remove hooks from every configured repo in this workspace")
    .action(async (options: { repo?: string; repoRoot?: string; all?: boolean }) => {
      const { targets } = await resolveHookTargets(options);
      for (const target of targets) {
        const gitDir = await detectGitDir(target.root);
        const removed = uninstallPreCommitHook(gitDir);
        console.log(removed ? `Removed managed pre-commit hook for ${target.id}.` : `No managed pre-commit hook found for ${target.id}.`);
      }
    });
}
