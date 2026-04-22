import path from "node:path";
import { Command } from "commander";
import { initLayout } from "@cockpit-ai/config";
import { detectRepoRoot, detectGitDir, discoverRepoForWorkspace } from "@cockpit-ai/git";
import { installPreCommitHook } from "@cockpit-ai/hooks";

function slugifyWorkspaceName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Initialize a Cockpit workspace in the current directory")
    .option("--name <name>", "Workspace name")
    .option("--force", "Overwrite an existing .cockpit directory")
    .option("--hooks", "Install the managed pre-commit hook immediately")
    .action(async (options: { name?: string; force?: boolean; hooks?: boolean }) => {
      const root = process.cwd();
      const workspaceName = options.name ?? (slugifyWorkspaceName(path.basename(root)) || "cockpit-workspace");
      const repos = await discoverRepoForWorkspace(root, workspaceName);

      const result = initLayout({
        root,
        workspaceName,
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
          cockpitBin: path.join(result.cockpitDir, "bin", "cockpit"),
        });
      }

      console.log(`Initialized Cockpit in ${result.cockpitDir}`);
      console.log(`Config: ${result.configPath}`);
      console.log(`Shim:   ${result.shimPath}`);
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
      console.log("  cockpit doctor");
      console.log("  cockpit repos list");
      console.log("  cockpit status");
    });
}
