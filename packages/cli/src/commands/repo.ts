import path from "node:path";
import { Command } from "commander";
import { findProject, loadConfig } from "@backlog/config";
import { detectRepoRoot, repoCurrentBranch } from "@backlog/git";
import { addRepo, cloneAndAddRepo, getRepo, listRepos, removeRepo, updateRepo } from "@backlog/core";
import { repoCheckoutPath } from "@backlog/schemas";

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

function repositoryLocationLabel(repo: { location?: string | undefined; remote_type?: string | undefined; remote_provider?: string | undefined }): string {
  if ((repo.location ?? "local") !== "remote") return "local";
  const pieces = ["remote"];
  if (repo.remote_type) pieces.push(repo.remote_type);
  if (repo.remote_provider) pieces.push(repo.remote_provider);
  return pieces.join("/");
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
  const repos = program.command("repositories").description("Manage project repositories");

  repos
    .command("list")
    .description("List configured repositories")
    .option("--enabled <enabled>", "Only show enabled or disabled repositories")
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
        console.log("No repositories configured.");
        return;
      }
      for (const repo of repos) {
        const checkoutPath = repoCheckoutPath(repo) ?? "(no local checkout)";
        console.log(`${repo.id} | ${repositoryLocationLabel(repo)} | enabled=${repo.enabled} | branch=${repo.default_branch} | ${checkoutPath}`);
      }
    });

  repos
    .command("show")
    .description("Show one configured repository")
    .argument("<repository-id>", "Repository id")
    .option("--json", "Emit machine-readable JSON")
    .action((repoId: string, options: { json?: boolean }) => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }
      const repo = getRepo(workspace.backlogDir, repoId);
      if (!repo) {
        throw new Error(`Unknown repository: ${repoId}`);
      }
      if (options.json) {
        console.log(JSON.stringify(repo, null, 2));
        return;
      }
      console.log(`Repository: ${repo.id}`);
      console.log(`Path: ${repoCheckoutPath(repo) ?? "(no local checkout)"}`);
      console.log(`Location: ${repo.location ?? "local"}`);
      if ((repo.location ?? "local") === "remote") {
        if (repo.remote_type) console.log(`Remote type: ${repo.remote_type}`);
        if (repo.remote_provider) console.log(`Remote provider: ${repo.remote_provider}`);
        if (repo.remote_url) console.log(`Remote URL: ${repo.remote_url}`);
      }
      console.log(`Enabled: ${repo.enabled}`);
      console.log(`Default branch: ${repo.default_branch}`);
      if (repo.role) {
        console.log(`Role: ${repo.role}`);
      }
    });

  repos
    .command("add")
    .description("Add one repository to the project (local path) or clone from a Git URL")
    .option("--path <path>", "Path to a local repository (mutually exclusive with --url)")
    .option("--url <url>", "Git URL to clone (e.g. https://github.com/user/repository.git)")
    .option("--clone-into <path>", "Destination directory for the clone; defaults to <project-state>/repositories/<id>")
    .option("--id <id>", "Repository id; defaults to the repository directory name (or URL slug)")
    .option("--default-branch <branch>", "Default branch; defaults to the detected git branch or project default")
    .option("--role <role>", "Optional repository role")
    .option("--disabled", "Add the repository as disabled")
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
        console.log(`Cloned and added repository ${repo.id} → ${repo.path}`);
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
        location: "local",
      });
      console.log(`Added repository ${repo.id}`);
    });

  repos
    .command("update")
    .description("Update one configured repository")
    .argument("<repository-id>", "Repository id")
    .option("--id <id>", "Rename the repository id")
    .option("--path <path>", "Move the repository path")
    .option("--default-branch <branch>", "Override the default branch")
    .option("--role <role>", "Set a repository role")
    .option("--clear-role", "Remove the repository role")
    .option("--enable", "Enable this repository")
    .option("--disable", "Disable this repository")
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
      console.log(`Updated repository ${repo.id}`);
    });

  repos
    .command("remove")
    .description("Remove one repository from the project")
    .argument("<repository-id>", "Repository id")
    .option("--force", "Also clean linked tasks, tasks, and agent scopes")
    .action((repoId: string, options: { force?: boolean }) => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }
      const repo = removeRepo(workspace.backlogDir, repoId, {
        ...(options.force ? { force: true } : {}),
      });
      console.log(`Removed repository ${repo.id}`);
    });
}
