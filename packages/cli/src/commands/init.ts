import path from "node:path";
import { Command } from "commander";
import { initLayout } from "@cockpit-ai/config";
import { detectRepoRoot, detectGitDir } from "@cockpit-ai/git";
import { installPreCommitHook } from "@cockpit-ai/hooks";
import type { RepoConfig } from "@cockpit-ai/schemas";

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

      let repos: RepoConfig[] = [];
      try {
        const repoRoot = await detectRepoRoot(root);
        repos = [
          {
            id: path.basename(repoRoot),
            path: repoRoot,
            default_branch: "main",
            enabled: true,
          },
        ];
      } catch {
        repos = [];
      }

      const result = initLayout({
        root,
        workspaceName,
        ...(options.force ? { force: true } : {}),
        repos,
      });

      if (options.hooks) {
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
      console.log("Next:");
      console.log("  cockpit doctor");
      console.log("  cockpit status");
    });
}
