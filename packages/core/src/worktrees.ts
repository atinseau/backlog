import fs from "node:fs";
import path from "node:path";
import { execa } from "execa";
import { getSecret } from "@backlog/config";
import { detectGitDir, git } from "@backlog/git";
import { repoCheckoutPath, type ProjectConfig, type RepoConfig } from "@backlog/schemas";
import { listActiveRuns, listArchivedRuns } from "./run-store.js";

function worktreesRoot(backlogDir: string): string {
  return path.join(backlogDir, "worktrees");
}

function remoteExecutionRoot(backlogDir: string): string {
  return path.join(backlogDir, "remote-checkouts");
}

export function remoteExecutionCheckoutRoot(backlogDir: string, repoId: string, runId: string): string {
  return path.join(remoteExecutionRoot(backlogDir), repoId, runId);
}

export function remoteExecutionBasePath(backlogDir: string, repoId: string, runId: string): string {
  return path.join(remoteExecutionCheckoutRoot(backlogDir, repoId, runId), "repo");
}

function repositoryRemoteUrl(repo: RepoConfig): string | null {
  return repo.remote_url ?? repo.git_url ?? null;
}

export function isGitRemoteRepository(repo: RepoConfig): boolean {
  if ((repo.location ?? "local") !== "remote") return false;
  const remoteType = repo.remote_type ?? (repo.git_url || repo.provider ? "git" : undefined);
  return remoteType === "git" && Boolean(repositoryRemoteUrl(repo));
}

function githubFullNameFromUrl(value: string): string | null {
  const trimmed = value.trim();
  const match =
    trimmed.match(/github\.com[:/]([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:[#?].*)?$/i) ??
    trimmed.match(/^([^/\s]+)\/([^/\s#?]+?)(?:\.git)?$/i);
  if (!match?.[1] || !match[2]) return null;
  const owner = match[1];
  const repo = match[2].replace(/\.git$/i, "");
  return `${owner}/${repo}`;
}

function cloneUrlsForRemoteExecution(backlogDir: string, repo: RepoConfig): { cloneUrl: string; cleanUrl: string } {
  const cleanUrl = repositoryRemoteUrl(repo);
  if (!cleanUrl) {
    throw new Error("repository_remote_url_missing");
  }
  const provider = repo.remote_provider ?? (repo.provider === "github" ? "github" : undefined);
  const fullName = provider === "github" ? githubFullNameFromUrl(cleanUrl) : null;
  const token = fullName ? getSecret(backlogDir, "github.pat") : null;
  if (fullName && token) {
    return {
      cloneUrl: `https://x-access-token:${encodeURIComponent(token)}@github.com/${fullName}.git`,
      cleanUrl: `https://github.com/${fullName}.git`,
    };
  }
  return { cloneUrl: cleanUrl, cleanUrl };
}

function sanitizeCloneDetail(value: string, cloneUrl: string, cleanUrl: string): string {
  return value
    .replaceAll(cloneUrl, cleanUrl)
    .replace(/x-access-token:[^@]+@github\.com/gi, "x-access-token:***@github.com")
    .trim()
    .slice(0, 600);
}

async function cloneForRemoteExecution(input: {
  url: string;
  cleanUrl: string;
  dest: string;
  branch?: string;
}): Promise<void> {
  fs.mkdirSync(path.dirname(input.dest), { recursive: true });
  const runClone = async (branch?: string): Promise<{ exitCode: number | null; stdout: string; stderr: string }> => {
    const result = await execa("git", cloneArgs(branch), { reject: false });
    return { exitCode: result.exitCode ?? null, stdout: result.stdout, stderr: result.stderr };
  };
  const cloneArgs = (branch?: string): string[] => {
    const args = ["clone"];
    if (branch) args.push("--branch", branch);
    args.push("--", input.url, input.dest);
    return args;
  };
  let result = await runClone(input.branch);
  if (result.exitCode !== 0 && input.branch && /remote branch .* not found|repository not found/i.test(result.stderr + result.stdout)) {
    fs.rmSync(input.dest, { recursive: true, force: true });
    result = await runClone();
  }
  if (result.exitCode !== 0) {
    throw new Error(`remote_checkout_clone_failed:${sanitizeCloneDetail(result.stderr || result.stdout, input.url, input.cleanUrl)}`);
  }
}

export async function ensureRemoteExecutionCheckout(params: {
  backlogDir: string;
  repo: RepoConfig;
  runId: string;
}): Promise<string> {
  if (!isGitRemoteRepository(params.repo)) {
    throw new Error("repository_is_not_git_remote");
  }
  const dest = remoteExecutionBasePath(params.backlogDir, params.repo.id, params.runId);
  if (fs.existsSync(path.join(dest, ".git"))) {
    return dest;
  }
  fs.rmSync(remoteExecutionCheckoutRoot(params.backlogDir, params.repo.id, params.runId), { recursive: true, force: true });
  const { cloneUrl, cleanUrl } = cloneUrlsForRemoteExecution(params.backlogDir, params.repo);
  await cloneForRemoteExecution({
    url: cloneUrl,
    cleanUrl,
    dest,
    branch: params.repo.default_branch,
  });
  if (cloneUrl !== cleanUrl) {
    await git(["remote", "set-url", "origin", cleanUrl], dest).catch(() => undefined);
  }
  return dest;
}

export function cleanupRemoteExecutionCheckout(backlogDir: string, repoId: string, runId: string): boolean {
  const root = remoteExecutionCheckoutRoot(backlogDir, repoId, runId);
  if (!fs.existsSync(root)) return false;
  fs.rmSync(root, { recursive: true, force: true });
  return true;
}

export function buildRunBranchName(taskId: string, taskTitle: string, runId?: string): string {
  // Slugify: lowercase, non-alnum → -, trim leading/trailing -, cap at
  // 32 chars. Then re-trim trailing - because slicing at 32 can land
  // on a separator dash (e.g. "with-hello-world-" → after concat
  // becomes "with-hello-world--run_022", with the visible double dash
  // that the user spotted in the activity log).
  const slug = taskTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32)
    .replace(/-+$/g, "");
  const base = `backlog/${taskId}-${slug || "task"}`;
  // Append the run id so branches are unique per run. Without this, a
  // re-try of the same subtask after an earlier run failed (and its
  // worktree didn't get cleaned up) would hit `git worktree add` with
  // a branch name already in use → exit 255 → "worktree_failed".
  //
  // We use `-` (not `/`) as the separator on purpose. With `/` the
  // new branch would be `backlog/<task>-<slug>/<runId>` — but the
  // OLD branch `backlog/<task>-<slug>` already exists in upgraded
  // workspaces, and git refuses to create `foo/bar` when a leaf
  // branch `foo` exists (refs are stored as files, can't be both a
  // file and a directory). `-` keeps every branch a sibling under
  // `refs/heads/backlog/`, so legacy branches and new ones coexist.
  return runId ? `${base}-${runId}` : base;
}

export async function ensureWorktree(params: {
  backlogDir: string;
  repoId: string;
  repoPath: string;
  branch: string;
  runId: string;
}): Promise<string> {
  const target = path.join(worktreesRoot(params.backlogDir), params.repoId, params.runId);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  await git(["worktree", "add", "-b", params.branch, target], params.repoPath);
  return target;
}

export async function writeWorktreeContext(worktreePath: string, runId: string, claimId: string): Promise<void> {
  const gitDir = await detectGitDir(worktreePath);
  fs.writeFileSync(
    path.join(gitDir, "backlog-context.json"),
    JSON.stringify(
      {
        version: 1,
        claim_id: claimId,
        run_id: runId,
        updated_at: new Date().toISOString(),
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
}

export interface WorktreeGcResult {
  removed: string[];
  skipped: string[];
}

export interface KnownWorktree {
  runId: string;
  repo: string;
  branch: string;
  status: string;
  path: string;
  exists: boolean;
  active: boolean;
}

/**
 * A run record from the removed `direct` execution mode: its `worktree_path`
 * is the repository's own checkout, not an isolated worktree. Nothing migrates
 * archived records — `schemas/src/run.ts` just strips the old `execution_mode`
 * field on read — so these exist in real installs and have to be recognised by
 * path. Both readers below owe them the same answer: GC must not try to remove
 * the user's main working tree, and `worktree list` must not present it as a
 * Backlog worktree.
 */
function isRepositoryCheckout(worktreePath: string, configuredCheckoutPath: string | null | undefined): boolean {
  if (!configuredCheckoutPath) return false;
  return path.resolve(worktreePath) === path.resolve(configuredCheckoutPath);
}

function repoCheckoutPaths(config: ProjectConfig): Map<string, string | undefined> {
  return new Map(config.repos.map((repo) => [repo.id, repoCheckoutPath(repo) ?? undefined]));
}

export function listKnownWorktrees(backlogDir: string, config: ProjectConfig): KnownWorktree[] {
  const repoPaths = repoCheckoutPaths(config);
  const describe = (active: boolean) => (run: { id: string; repo: string; branch: string; status: string; worktree_path: string }) => ({
    runId: run.id,
    repo: run.repo,
    branch: run.branch,
    status: run.status,
    path: run.worktree_path,
    exists: fs.existsSync(run.worktree_path),
    active,
  });
  const isWorktree = (run: { repo: string; worktree_path: string }): boolean =>
    !isRepositoryCheckout(run.worktree_path, repoPaths.get(run.repo));
  return [
    ...listActiveRuns(backlogDir).filter(isWorktree).map(describe(true)),
    ...listArchivedRuns(backlogDir).filter(isWorktree).map(describe(false)),
  ];
}

export async function garbageCollectWorktrees(
  backlogDir: string,
  config: ProjectConfig,
  options?: { dryRun?: boolean },
): Promise<WorktreeGcResult> {
  const result: WorktreeGcResult = {
    removed: [],
    skipped: [],
  };
  const repoPaths = repoCheckoutPaths(config);
  const archivedRuns = listArchivedRuns(backlogDir);
  const activeRuns = listActiveRuns(backlogDir);

  for (const run of activeRuns) {
    if (run.status === "running" || run.status === "preparing" || run.status === "awaiting_review") {
      result.skipped.push(run.worktree_path);
      continue;
    }
  }

  for (const run of archivedRuns) {
    const remoteRoot = remoteExecutionCheckoutRoot(backlogDir, run.repo, run.id);
    const hadRemoteRoot = fs.existsSync(remoteRoot);
    if (!fs.existsSync(run.worktree_path)) {
      if (hadRemoteRoot) {
        if (!options?.dryRun) {
          cleanupRemoteExecutionCheckout(backlogDir, run.repo, run.id);
        }
        result.removed.push(remoteRoot);
      }
      continue;
    }
    // A legacy direct-mode record points at the repository's own checkout.
    // `git worktree remove` on a main working tree fails, and this loop has no
    // try/catch of its own, so that exception would abort GC for every run
    // queued after it.
    if (isRepositoryCheckout(run.worktree_path, repoPaths.get(run.repo))) {
      result.skipped.push(run.worktree_path);
      continue;
    }
    const remoteBase = remoteExecutionBasePath(backlogDir, run.repo, run.id);
    const repoPath = repoPaths.get(run.repo) ?? (fs.existsSync(remoteBase) ? remoteBase : undefined);
    if (!repoPath) {
      result.skipped.push(run.worktree_path);
      continue;
    }
    if (!options?.dryRun) {
      // The guard above keys on the checkout path *as configured today*. Move
      // a repository in config.toml and a legacy record stops matching it, so
      // `git worktree remove --force` runs against a path that is not a
      // worktree and throws — taking every archived run after it down with it,
      // which is the exact failure the guard exists to prevent. One pass, one
      // bad record: skip it and keep going.
      try {
        await git(["worktree", "remove", "--force", run.worktree_path], repoPath);
      } catch {
        result.skipped.push(run.worktree_path);
        continue;
      }
      cleanupRemoteExecutionCheckout(backlogDir, run.repo, run.id);
    }
    result.removed.push(run.worktree_path);
    if (hadRemoteRoot) {
      result.removed.push(remoteRoot);
    }
  }

  return result;
}
