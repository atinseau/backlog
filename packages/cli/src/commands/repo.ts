import path from "node:path";
import { Command } from "commander";
import { findProject, loadConfig } from "@backlog/config";
import { detectRepoRoot, repoCurrentBranch } from "@backlog/git";
import { addRepo, cloneAndAddRepo, getRepo, listRepos, removeRepo, updateRepo } from "@backlog/core";

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function parseBooleanFlag(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (["true", "yes", "1"].includes(normalized)) {
    return true;
  }
  if (["false", "no", "0"].includes(normalized)) {
    return false;
  }
  throw new Error(`Expected a boolean value, received: ${value}`);
}

async function resolveRepoBranch(repoPath: string, fallback: string): Promise<string> {
  try {
    const repoRoot = await detectRepoRoot(repoPath);
    const branch = await repoCurrentBranch(repoRoot);
    return branch && branch !== "HEAD" ? branch : fallback;
  } catch {
    return fallback;
  }
}

export function registerRepoCommand(program: Command): void {
  const repos = program.command("repos").description("Manage workspace repos");

  repos
    .command("list")
    .description("List configured repos")
    .option("--enabled <enabled>", "Only show enabled or disabled repos")
    .option("--json", "Emit machine-readable JSON")
    .action((options: { enabled?: string; json?: boolean }) => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }

      const repos = listRepos(workspace.backlogDir).filter((repo) => {
        if (options.enabled === undefined) {
          return true;
        }
        return repo.enabled === parseBooleanFlag(options.enabled);
      });

      if (options.json) {
        console.log(JSON.stringify(repos, null, 2));
        return;
      }
      if (repos.length === 0) {
        console.log("No repos configured.");
        return;
      }
      for (const repo of repos) {
        console.log(`${repo.id} | enabled=${repo.enabled} | branch=${repo.default_branch} | ${repo.path}`);
      }
    });

  repos
    .command("show")
    .description("Show one configured repo")
    .argument("<repo-id>", "Repo id")
    .option("--json", "Emit machine-readable JSON")
    .action((repoId: string, options: { json?: boolean }) => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }
      const repo = getRepo(workspace.backlogDir, repoId);
      if (!repo) {
        throw new Error(`Unknown repo: ${repoId}`);
      }
      if (options.json) {
        console.log(JSON.stringify(repo, null, 2));
        return;
      }
      console.log(`Repo: ${repo.id}`);
      console.log(`Path: ${repo.path}`);
      console.log(`Enabled: ${repo.enabled}`);
      console.log(`Default branch: ${repo.default_branch}`);
      if (repo.role) {
        console.log(`Role: ${repo.role}`);
      }
    });

  repos
    .command("add")
    .description("Add one repo to the workspace (local path) or clone from a Git URL")
    .option("--path <path>", "Path to a local repo (mutually exclusive with --url)")
    .option("--url <url>", "Git URL to clone (e.g. https://github.com/user/repo.git)")
    .option("--clone-into <path>", "Destination directory for the clone; defaults to <workspace>/repos/<id>")
    .option("--id <id>", "Repo id; defaults to the repo directory name (or URL slug)")
    .option("--default-branch <branch>", "Default branch; defaults to the detected git branch or workspace default")
    .option("--role <role>", "Optional repo role")
    .option("--disabled", "Add the repo as disabled")
    .action(async (options: {
      id?: string;
      path?: string;
      url?: string;
      cloneInto?: string;
      defaultBranch?: string;
      role?: string;
      disabled?: boolean;
    }) => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }
      if (!options.path && !options.url) {
        throw new Error("Provide either --path <path> or --url <git-url>.");
      }
      if (options.path && options.url) {
        throw new Error("--path and --url are mutually exclusive.");
      }

      if (options.url) {
        const input: Parameters<typeof cloneAndAddRepo>[1] = { url: options.url };
        if (options.id) input.id = options.id;
        if (options.cloneInto) input.destDir = options.cloneInto;
        if (options.defaultBranch) input.defaultBranch = options.defaultBranch;
        if (options.role) input.role = options.role;
        if (options.disabled !== undefined) input.enabled = !options.disabled;
        const repo = await cloneAndAddRepo(workspace.backlogDir, input);
        console.log(`Cloned and added repo ${repo.id} → ${repo.path}`);
        return;
      }

      const config = loadConfig(workspace.backlogDir);
      const requestedPath = path.resolve(workspace.root, options.path!);
      const repoId = options.id ?? slugify(path.basename(requestedPath));
      const defaultBranch = options.defaultBranch ?? await resolveRepoBranch(requestedPath, config.default_branch);
      const repo = addRepo(workspace.backlogDir, {
        id: repoId,
        path: requestedPath,
        defaultBranch,
        ...(options.role ? { role: options.role } : {}),
        enabled: !options.disabled,
      });
      console.log(`Added repo ${repo.id}`);
    });

  repos
    .command("update")
    .description("Update one configured repo")
    .argument("<repo-id>", "Repo id")
    .option("--id <id>", "Rename the repo id")
    .option("--path <path>", "Move the repo path")
    .option("--default-branch <branch>", "Override the default branch")
    .option("--role <role>", "Set a repo role")
    .option("--clear-role", "Remove the repo role")
    .option("--enable", "Enable this repo")
    .option("--disable", "Disable this repo")
    .action((repoId: string, options: {
      id?: string;
      path?: string;
      defaultBranch?: string;
      role?: string;
      clearRole?: boolean;
      enable?: boolean;
      disable?: boolean;
    }) => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }
      if (options.enable && options.disable) {
        throw new Error("Use either --enable or --disable, not both.");
      }
      const repo = updateRepo(workspace.backlogDir, repoId, {
        ...(options.id !== undefined ? { id: options.id } : {}),
        ...(options.path !== undefined ? { path: path.resolve(workspace.root, options.path) } : {}),
        ...(options.defaultBranch !== undefined ? { defaultBranch: options.defaultBranch } : {}),
        ...(options.role !== undefined ? { role: options.role } : {}),
        ...(options.clearRole ? { clearRole: true } : {}),
        ...(options.enable ? { enabled: true } : {}),
        ...(options.disable ? { enabled: false } : {}),
      });
      console.log(`Updated repo ${repo.id}`);
    });

  repos
    .command("remove")
    .description("Remove one repo from the workspace")
    .argument("<repo-id>", "Repo id")
    .option("--force", "Also clean linked tasks, work items, and agent scopes")
    .action((repoId: string, options: { force?: boolean }) => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }
      const repo = removeRepo(workspace.backlogDir, repoId, {
        ...(options.force ? { force: true } : {}),
      });
      console.log(`Removed repo ${repo.id}`);
    });
}
