import path from "node:path";
import { Command } from "commander";
import { findWorkspace, loadConfig } from "@cockpit-ai/config";
import { detectRepoRoot, repoCurrentBranch } from "@cockpit-ai/git";
import { addRepo, getRepo, listRepos, removeRepo, updateRepo } from "@cockpit-ai/core";

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
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .cockpit workspace found. Run `cockpit init` first.");
      }

      const repos = listRepos(workspace.cockpitDir).filter((repo) => {
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
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .cockpit workspace found. Run `cockpit init` first.");
      }
      const repo = getRepo(workspace.cockpitDir, repoId);
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
    .description("Add one repo to the workspace")
    .requiredOption("--path <path>", "Path to the repo")
    .option("--id <id>", "Repo id; defaults to the repo directory name")
    .option("--default-branch <branch>", "Default branch; defaults to the detected git branch or workspace default")
    .option("--role <role>", "Optional repo role")
    .option("--disabled", "Add the repo as disabled")
    .action(async (options: {
      id?: string;
      path: string;
      defaultBranch?: string;
      role?: string;
      disabled?: boolean;
    }) => {
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .cockpit workspace found. Run `cockpit init` first.");
      }
      const config = loadConfig(workspace.cockpitDir);
      const requestedPath = path.resolve(workspace.root, options.path);
      const repoId = options.id ?? slugify(path.basename(requestedPath));
      const defaultBranch = options.defaultBranch ?? await resolveRepoBranch(requestedPath, config.default_branch);
      const repo = addRepo(workspace.cockpitDir, {
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
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .cockpit workspace found. Run `cockpit init` first.");
      }
      if (options.enable && options.disable) {
        throw new Error("Use either --enable or --disable, not both.");
      }
      const repo = updateRepo(workspace.cockpitDir, repoId, {
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
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .cockpit workspace found. Run `cockpit init` first.");
      }
      const repo = removeRepo(workspace.cockpitDir, repoId, {
        ...(options.force ? { force: true } : {}),
      });
      console.log(`Removed repo ${repo.id}`);
    });
}
