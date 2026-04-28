import path from "node:path";
import { Command } from "commander";
import { findProject, loadConfig } from "@backlog/config";
import { detectGitDir, detectRepoRoot } from "@backlog/git";
import {
  clearPause,
  inspectPreCommitHook,
  installPreCommitHook,
  pauseFilePath,
  readPauseUntil,
  uninstallPreCommitHook,
  writePauseUntil,
} from "@backlog/hooks";

interface HookTarget {
  id: string;
  root: string;
}

async function resolveHookTargets(options: {
  repo?: string;
  repoRoot?: string;
  all?: boolean;
}): Promise<{ workspace: NonNullable<ReturnType<typeof findProject>>; targets: HookTarget[] }> {
  const workspace = findProject();
  if (!workspace) {
    throw new Error("No .backlog project found. Run `backlog init` first.");
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
          projectRoot: workspace.root,
          backlogDir: workspace.backlogDir,
          ...(options.force ? { force: true } : {}),
        });
        console.log(`Installed pre-commit hook for ${target.id} at ${hookPath}`);
      }
    });

  hooks
    .command("pause")
    .description("Temporarily skip the pre-commit hook in this workspace (default 30 minutes)")
    .option("-m, --minutes <minutes>", "How long to pause the hook", "30")
    .action((options: { minutes: string }) => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }
      const minutes = Number.parseInt(options.minutes, 10);
      if (Number.isNaN(minutes) || minutes <= 0) {
        throw new Error(`Invalid --minutes value: ${options.minutes}`);
      }
      const until = new Date(Date.now() + minutes * 60_000).toISOString();
      const pausePath = writePauseUntil(workspace.backlogDir, until);
      console.log(`Pre-commit hook paused until ${until} (${minutes} min).`);
      console.log(`Pause file: ${pausePath}`);
      console.log("Run 'backlog hooks resume' to re-enable sooner.");
    });

  hooks
    .command("resume")
    .description("Resume the pre-commit hook by clearing an active pause")
    .action(() => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }
      const wasPaused = clearPause(workspace.backlogDir);
      if (wasPaused) {
        console.log("Pre-commit hook resumed.");
      } else {
        console.log(`Pre-commit hook is not paused (no ${pauseFilePath(workspace.backlogDir)}).`);
      }
    });

  hooks
    .command("paused")
    .description("Print the current pause expiration, if any")
    .action(() => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }
      const until = readPauseUntil(workspace.backlogDir);
      if (!until) {
        console.log("Not paused.");
        return;
      }
      const expired = Date.parse(until) <= Date.now();
      console.log(`Paused until: ${until}${expired ? " (expired)" : ""}`);
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

  hooks
    .command("dry-run")
    .description("Run `claim check` against given paths without committing — same gate the pre-commit hook applies")
    .option("--repo <id>", "Target one configured repo by id")
    .option("--repo-root <path>", "Target repo root. Defaults to current git repo")
    .option(
      "--path <path...>",
      "Repo-relative paths to validate. Without this flag, dry-run uses currently staged paths.",
    )
    .action(async (options: { repo?: string; repoRoot?: string; path?: string[] }) => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }
      const config = loadConfig(workspace.backlogDir);
      let repoRoot: string;
      if (options.repo) {
        const repo = config.repos.find((r) => r.id === options.repo);
        if (!repo) throw new Error(`Unknown repo: ${options.repo}`);
        repoRoot = repo.path;
      } else if (options.repoRoot) {
        repoRoot = options.repoRoot;
      } else {
        repoRoot = await detectRepoRoot();
      }

      // Driver: invoke the same `claim check` machinery the hook calls.
      // We exec the local shim binary so we follow whatever resolution
      // the hook itself would (env var, registry, etc.). Surfacing the
      // same exit code lets scripts wire it like the real hook.
      const backlogBin = path.join(workspace.backlogDir, "bin", "backlog");
      const args = ["claim", "check", "--repo-root", repoRoot];
      if (options.path && options.path.length > 0) {
        args.push("--path", ...options.path);
      } else {
        args.push("--staged");
      }
      const { spawn } = await import("node:child_process");
      const child = spawn(backlogBin, args, {
        stdio: "inherit",
        env: { ...process.env, BACKLOG_PROJECT_DIR: workspace.backlogDir },
      });
      const exitCode = await new Promise<number>((resolve) => {
        child.on("exit", (code) => resolve(code ?? 1));
      });
      // Force the same exit code as the inner `claim check` so dry-run
      // can be wired into scripts the way the actual hook would be.
      process.exit(exitCode);
    });
}
