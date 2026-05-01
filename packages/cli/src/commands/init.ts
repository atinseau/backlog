import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import {
  initLayout,
  registerProject,
  userLevelProjectDir,
  listRegisteredProjects,
} from "@backlog/config";
import { cloneRepo, detectGitProvider, detectRepoRoot, detectGitDir, discoverRepoForProject, repoIdFromGitUrl } from "@backlog/git";
import { installPreCommitHook } from "@backlog/hooks";

function slugifyWorkspaceName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// Counts immediate child directories that look like a git repo (i.e.
// contain a .git/ directory or file). Used by `init` to detect a
// multi-repo parent and suggest --user-level.
function countChildGitRepos(parent: string): number {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(parent, { withFileTypes: true });
  } catch {
    return 0;
  }
  let count = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === ".backlog" || entry.name.startsWith(".")) continue;
    if (fs.existsSync(path.join(parent, entry.name, ".git"))) count++;
  }
  return count;
}

interface InitOptions {
  name?: string;
  url?: string;
  cloneInto?: string;
  force?: boolean;
  hooks?: boolean;
  userLevel?: boolean;
  inRepo?: boolean;
}

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Initialize a Backlog project")
    .option("--name <name>", "Project name")
    .option("--url <git-url>", "Clone a remote Git repository before initializing the project")
    .option("--clone-into <path>", "Destination for --url; defaults to ./<repo>")
    .option(
      "--user-level",
      "Place project state at ~/.backlog/<name>/ instead of <repo>/.backlog/. Required for multi-repo projects.",
    )
    .option("--in-repo", "Force in-repo placement (default; .backlog/ is created in the current repository).")
    .option("--force", "Overwrite an existing project state directory")
    .option("--hooks", "Install the managed pre-commit hook immediately")
    .action(async (options: InitOptions) => {
      if (options.userLevel && options.inRepo) {
        throw new Error("--user-level and --in-repo are mutually exclusive.");
      }

      const cwd = process.cwd();
      const cloneDest = options.url
        ? path.resolve(cwd, options.cloneInto ?? repoIdFromGitUrl(options.url))
        : cwd;
      const sourceRoot = cloneDest;
      const projectName = options.name ?? (
        options.url
          ? (repoIdFromGitUrl(options.url) || "backlog-project")
          : (slugifyWorkspaceName(path.basename(cwd)) || "backlog-project")
      );
      const location = options.userLevel ? "user_level" : "in_repo";

      if (options.url) {
        await cloneRepo({
          url: options.url,
          dest: cloneDest,
        });
      }

      // Hint: when init is run in a dir that contains multiple immediate
      // git-repo subdirs and the user didn't pick a layout explicitly,
      // they're almost certainly in a multi-repo project parent. The
      // in_repo default would land .backlog/ in that parent (which usually
      // isn't itself a repo) — point them at --user-level instead.
      if (!options.userLevel && !options.inRepo) {
        const childGitRepos = options.url ? 0 : countChildGitRepos(cwd);
        if (childGitRepos >= 2) {
          console.log("");
          console.log(`Detected ${childGitRepos} git repos as direct children of ${cwd}.`);
          console.log("Tip: for multi-repo projects pass --user-level so project state lives at");
          console.log(`     ~/.backlog/<slug>/ instead of ${cwd}/.backlog/. Re-run with --in-repo to`);
          console.log("     suppress this hint and keep the in-repo layout.");
          console.log("");
        }
      }

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
      const root = location === "user_level" ? userLevelProjectDir(projectName) : sourceRoot;

      let repos = await discoverRepoForProject(sourceRoot, projectName);
      if (options.url && repos[0]) {
        repos = [
          {
            ...repos[0],
            id: repoIdFromGitUrl(options.url),
            git_url: options.url,
            provider: detectGitProvider(options.url),
          },
        ];
      }

      if (location === "user_level" && fs.existsSync(path.join(root, "config.toml")) && !options.force) {
        throw new Error(`Backlog project already initialized at ${root} (use --force to overwrite).`);
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
        const repoRoot = await detectRepoRoot(sourceRoot);
        const gitDir = await detectGitDir(repoRoot);
        installPreCommitHook({
          gitDir,
          backlogBin: path.join(result.backlogDir, "bin", "backlog"),
          projectRoot: location === "user_level" ? result.backlogDir : root,
          backlogDir: result.backlogDir,
        });
      }

      const registryEntry = registerProject({ projectRoot: root, location });

      console.log(`Initialized Backlog project in ${result.backlogDir}`);
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
