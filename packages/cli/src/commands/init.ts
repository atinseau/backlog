import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import {
  initLayout,
  registerProject,
  userLevelWorkspaceDir,
  listRegisteredProjects,
} from "@backlog/config";
import { detectRepoRoot, detectGitDir, discoverRepoForWorkspace } from "@backlog/git";
import { installPreCommitHook } from "@backlog/hooks";

function slugifyWorkspaceName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

interface InitOptions {
  name?: string;
  force?: boolean;
  hooks?: boolean;
  userLevel?: boolean;
  inRepo?: boolean;
}

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Initialize a Backlog workspace")
    .option("--name <name>", "Workspace name")
    .option(
      "--user-level",
      "Place the workspace at ~/.backlog/<name>/ instead of <cwd>/.backlog/. Required for multi-repo projects.",
    )
    .option("--in-repo", "Force in-repo placement (default; .backlog/ is created in the current directory).")
    .option("--force", "Overwrite an existing workspace")
    .option("--hooks", "Install the managed pre-commit hook immediately")
    .action(async (options: InitOptions) => {
      if (options.userLevel && options.inRepo) {
        throw new Error("--user-level and --in-repo are mutually exclusive.");
      }

      const cwd = process.cwd();
      const projectName = options.name ?? (slugifyWorkspaceName(path.basename(cwd)) || "backlog-workspace");
      const location = options.userLevel ? "user_level" : "in_repo";

      // user_level: collide-check on the project name before creating anything.
      if (location === "user_level") {
        const existing = listRegisteredProjects().find(
          (p) => p.location === "user_level" && p.name === projectName,
        );
        if (existing) {
          throw new Error(
            `A user-level project named "${projectName}" is already registered (id=${existing.id} at ${existing.path}). Pick a different name with --name.`,
          );
        }
      }

      // user_level: target dir is ~/.backlog/<slug>/. Refuse a silent overwrite
      // unless --force; same for in_repo via initLayout's existing check.
      const root = location === "user_level" ? userLevelWorkspaceDir(projectName) : cwd;

      const repos = await discoverRepoForWorkspace(cwd, projectName);

      if (location === "user_level" && fs.existsSync(path.join(root, "config.toml")) && !options.force) {
        throw new Error(`Backlog workspace already initialized at ${root} (use --force to overwrite).`);
      }

      const result = initLayout({
        root,
        projectName,
        location,
        ...(options.force ? { force: true } : {}),
        repos,
      });

      if (options.hooks) {
        if (repos.length === 0) {
          throw new Error("Cannot install hooks because the current directory is not inside a git repository.");
        }
        const repoRoot = await detectRepoRoot(cwd);
        const gitDir = await detectGitDir(repoRoot);
        installPreCommitHook({
          gitDir,
          backlogBin: path.join(result.backlogDir, "bin", "backlog"),
          projectRoot: location === "user_level" ? result.backlogDir : root,
          backlogDir: result.backlogDir,
        });
      }

      const registryEntry = registerProject({ projectRoot: root, location });

      console.log(`Initialized Backlog in ${result.backlogDir}`);
      console.log(`Location: ${result.location}`);
      console.log(`Config: ${result.configPath}`);
      console.log(`Shim:   ${result.shimPath}`);
      console.log(`Registered as ${registryEntry.id}`);
      if (repos.length > 0) {
        console.log("Repos:");
        for (const repo of repos) {
          console.log(`  ${repo.id} -> ${repo.path} (${repo.default_branch})`);
        }
      } else {
        console.log("Repos:");
        console.log("  none detected yet");
      }
      console.log("Next:");
      console.log("  backlog doctor");
      console.log("  backlog repos list");
      console.log("  backlog status");
    });
}
