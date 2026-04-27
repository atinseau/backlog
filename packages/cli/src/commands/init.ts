import path from "node:path";
import { Command } from "commander";
import { initLayout, registerProject } from "@backlog/config";
import { detectRepoRoot, detectGitDir, discoverRepoForWorkspace } from "@backlog/git";
import { installPreCommitHook } from "@backlog/hooks";

function slugifyWorkspaceName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Initialize a Backlog workspace in the current directory")
    .option("--name <name>", "Workspace name")
    .option("--force", "Overwrite an existing .backlog directory")
    .option("--hooks", "Install the managed pre-commit hook immediately")
    .action(async (options: { name?: string; force?: boolean; hooks?: boolean }) => {
      const root = process.cwd();
      const projectName = options.name ?? (slugifyWorkspaceName(path.basename(root)) || "backlog-workspace");
      const repos = await discoverRepoForWorkspace(root, projectName);

      const result = initLayout({
        root,
        projectName,
        ...(options.force ? { force: true } : {}),
        repos,
      });

      if (options.hooks) {
        if (repos.length === 0) {
          throw new Error("Cannot install hooks because the current workspace is not inside a git repository.");
        }
        const repoRoot = await detectRepoRoot(root);
        const gitDir = await detectGitDir(repoRoot);
        installPreCommitHook({
          gitDir,
          backlogBin: path.join(result.backlogDir, "bin", "backlog"),
          projectRoot: root,
        });
      }

      const registryEntry = registerProject({ projectRoot: root });

      console.log(`Initialized Backlog in ${result.backlogDir}`);
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
