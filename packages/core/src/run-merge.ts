import { execa } from "execa";
import type { GitMergeStrategy, ProjectConfig, Run } from "@backlog/schemas";

export interface MergeOptions {
  strategy: GitMergeStrategy;
  // Branch to merge into. Defaults to the repo's `default_branch`
  // when the workspace `merge_target` isn't set.
  target: string;
}

export interface MergeResult {
  ok: boolean;
  strategy: GitMergeStrategy;
  target: string;
  branch: string;
  // Set when ok=false. One-line user-facing reason — already trimmed
  // and short enough to put in an event message.
  error?: string;
  // Trailing log from git when relevant (full stderr, capped). Useful
  // for the chat agent to relay verbatim if the user asks "why?".
  detail?: string;
}

interface SpawnResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

async function safeRun(args: string[], cwd: string): Promise<SpawnResult> {
  const r = await execa("git", args, { cwd, reject: false });
  return { exitCode: r.exitCode ?? null, stdout: r.stdout, stderr: r.stderr };
}

function mergeOptionsFor(config: ProjectConfig, repoDefaultBranch: string): MergeOptions | null {
  const strategy = config.git.merge_strategy;
  if (strategy === "none") return null;
  return {
    strategy,
    target: config.git.merge_target ?? repoDefaultBranch,
  };
}

// Merge a run's branch into its target. Caller is responsible for
// resolving repoPath (the user's main checkout) and repoDefaultBranch
// (defaults to "main"). Returns ok=false on any failure (dirty tree,
// merge conflict, branch already merged elsewhere, etc.) instead of
// throwing — approve flow keeps going either way.
export async function mergeRunBranch(input: {
  run: Run;
  repoPath: string;
  repoDefaultBranch: string;
  config: ProjectConfig;
}): Promise<MergeResult | null> {
  const opts = mergeOptionsFor(input.config, input.repoDefaultBranch);
  if (!opts) return null;
  const branch = input.run.branch;

  // Pre-flight: target branch must be checked out cleanly. If the user
  // has work in progress in their main checkout, refuse — we never
  // touch a dirty tree.
  const head = await safeRun(["symbolic-ref", "--short", "HEAD"], input.repoPath);
  if (head.exitCode !== 0) {
    return {
      ok: false,
      strategy: opts.strategy,
      target: opts.target,
      branch,
      error: "main checkout is in detached HEAD",
      detail: head.stderr.trim(),
    };
  }
  if (head.stdout.trim() !== opts.target) {
    return {
      ok: false,
      strategy: opts.strategy,
      target: opts.target,
      branch,
      error: `main checkout is on '${head.stdout.trim()}', not '${opts.target}'`,
    };
  }
  const status = await safeRun(["status", "--porcelain"], input.repoPath);
  if (status.stdout.trim().length > 0) {
    return {
      ok: false,
      strategy: opts.strategy,
      target: opts.target,
      branch,
      error: `${opts.target} has uncommitted changes — refusing to merge`,
      detail: status.stdout.trim().split("\n").slice(0, 5).join("\n"),
    };
  }

  // The actual merge. Use --ff-only or --no-ff per strategy. Both
  // produce a non-zero exit when conflicts arise — we report and
  // leave the user to resolve by hand.
  const args =
    opts.strategy === "fast_forward"
      ? ["merge", "--ff-only", branch]
      : ["merge", "--no-ff", "-m", `Merge backlog run ${input.run.id}: ${branch}`, branch];
  const merge = await safeRun(args, input.repoPath);
  if (merge.exitCode !== 0) {
    return {
      ok: false,
      strategy: opts.strategy,
      target: opts.target,
      branch,
      error: `git merge failed (exit ${merge.exitCode})`,
      detail: (merge.stderr || merge.stdout).trim().slice(0, 800),
    };
  }
  return { ok: true, strategy: opts.strategy, target: opts.target, branch };
}

// Tear down a worktree + optionally delete its branch. Best-effort:
// failures are reported but don't throw, because approve has already
// done its work and we don't want one stale lock to break the flow.
export async function cleanupRunWorktree(input: {
  worktreePath: string;
  branch: string;
  repoPath: string;
  deleteBranch: boolean;
}): Promise<{ removedWorktree: boolean; deletedBranch: boolean; error?: string }> {
  const remove = await safeRun(["worktree", "remove", "--force", input.worktreePath], input.repoPath);
  const removedWorktree = remove.exitCode === 0;
  let deletedBranch = false;
  let error: string | undefined;
  if (!removedWorktree) {
    error = (remove.stderr || remove.stdout).trim().slice(0, 400);
  }
  if (input.deleteBranch) {
    // -d (safe) only deletes if merged into the current branch — that's
    // exactly what we want, since we've just merged in the caller.
    // Fall through silently if it can't (unmerged work etc.).
    const del = await safeRun(["branch", "-d", input.branch], input.repoPath);
    deletedBranch = del.exitCode === 0;
  }
  const out: { removedWorktree: boolean; deletedBranch: boolean; error?: string } = {
    removedWorktree,
    deletedBranch,
  };
  if (error !== undefined) out.error = error;
  return out;
}
