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

const INTERNAL_RUN_FILES = [
  ".backlog-claude-prompt.md",
  ".backlog-claude.log",
  ".backlog-codex-prompt.md",
  ".backlog-codex-last-message.md",
  ".backlog-codex.log",
  ".backlog-executor.log",
  ".backlog-run.patch",
];

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
  // Ignore untracked files in the preflight. In in-repo workspaces,
  // Backlog's own `.backlog/` state is often untracked and should not
  // make every apply fail. Tracked modifications still block here; if
  // an untracked user file would actually be overwritten by the merge,
  // `git merge` itself exits non-zero and we surface that detail.
  const status = await safeRun(["status", "--porcelain", "--untracked-files=no"], input.repoPath);
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

export async function sanitizeRunBranch(input: {
  worktreePath: string;
}): Promise<{ ok: boolean; changed: boolean; sha?: string; error?: string; detail?: string }> {
  const tracked = await safeRun(["ls-files", "--", ...INTERNAL_RUN_FILES], input.worktreePath);
  if (tracked.exitCode !== 0) {
    return { ok: false, changed: false, error: "git ls-files failed", detail: tracked.stderr.trim().slice(0, 400) };
  }
  const files = tracked.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  if (files.length === 0) {
    return { ok: true, changed: false };
  }

  const remove = await safeRun(["rm", "-f", "--", ...files], input.worktreePath);
  if (remove.exitCode !== 0) {
    return { ok: false, changed: false, error: "git rm failed", detail: remove.stderr.trim().slice(0, 400) };
  }

  const commit = await safeRun([
    "-c",
    "user.name=Backlog",
    "-c",
    "user.email=backlog@example.com",
    "commit",
    "-m",
    "chore(backlog): remove internal run artifacts",
    "--no-verify",
  ], input.worktreePath);
  if (commit.exitCode !== 0) {
    return { ok: false, changed: false, error: "git commit failed", detail: (commit.stderr || commit.stdout).trim().slice(0, 400) };
  }
  const rev = await safeRun(["rev-parse", "HEAD"], input.worktreePath);
  const sha = rev.stdout.trim();
  return sha
    ? { ok: true, changed: true, sha }
    : { ok: true, changed: true };
}

// Stage every change in the worktree and create a commit. Returns
// { ok, sha } on success or an error message. Idempotent: if there's
// nothing to commit, ok=true with sha=null.
//
// This is what makes the "agent edited files but the work survives"
// invariant true. Without it, claude-code writes files in the
// worktree, the run finishes, the worktree gets torn down on approve,
// and the work is lost (the branch SHA never moved past initial).
export async function commitWorktreeChanges(input: {
  worktreePath: string;
  message: string;
  authorName?: string;
  authorEmail?: string;
}): Promise<{ ok: boolean; sha: string | null; error?: string; detail?: string }> {
  const cwd = input.worktreePath;
  // Stage user changes, then unstage Backlog's own run artifacts.
  // Prompt/log/patch files are useful for inspection, but must never
  // become part of the branch the user applies to their project.
  const add = await safeRun(["add", "-A"], cwd);
  if (add.exitCode !== 0) {
    return { ok: false, sha: null, error: "git add failed", detail: add.stderr.trim().slice(0, 400) };
  }
  const resetInternal = await safeRun(["reset", "-q", "--", ...INTERNAL_RUN_FILES], cwd);
  if (resetInternal.exitCode !== 0) {
    return { ok: false, sha: null, error: "git reset failed", detail: resetInternal.stderr.trim().slice(0, 400) };
  }
  // Anything to commit? `diff --cached --quiet` exits 1 when staged
  // changes exist, 0 when the index is clean.
  const diff = await safeRun(["diff", "--cached", "--quiet"], cwd);
  if (diff.exitCode === 0) {
    return { ok: true, sha: null };
  }
  const args = ["commit", "-m", input.message];
  if (input.authorName) args.push("-c", `user.name=${input.authorName}`);
  if (input.authorEmail) args.push("-c", `user.email=${input.authorEmail}`);
  // Skip the project's own pre-commit hook on the agent's commit —
  // we're committing inside an agent's isolated worktree, the human
  // will review the diff at approve time.
  args.push("--no-verify");
  const commit = await safeRun(args, cwd);
  if (commit.exitCode !== 0) {
    return { ok: false, sha: null, error: "git commit failed", detail: (commit.stderr || commit.stdout).trim().slice(0, 400) };
  }
  const rev = await safeRun(["rev-parse", "HEAD"], cwd);
  return { ok: true, sha: rev.stdout.trim() || null };
}

// Push the worktree's current branch to origin. Returns ok=false
// (with a reason) when the repo has no `origin` remote — that's
// expected for local-only repos and shouldn't crash the run.
export async function pushWorktreeBranch(input: {
  worktreePath: string;
  branch: string;
}): Promise<{ ok: boolean; error?: string; detail?: string }> {
  const cwd = input.worktreePath;
  // Probe origin first. Avoids a noisy "remote not found" stderr.
  const remotes = await safeRun(["remote"], cwd);
  if (remotes.exitCode !== 0 || !remotes.stdout.split("\n").includes("origin")) {
    return { ok: false, error: "no_origin_remote" };
  }
  const push = await safeRun(["push", "-u", "origin", input.branch], cwd);
  if (push.exitCode !== 0) {
    return {
      ok: false,
      error: `git push failed (exit ${push.exitCode})`,
      detail: (push.stderr || push.stdout).trim().slice(0, 400),
    };
  }
  return { ok: true };
}

// Open a pull request via the `gh` CLI (GitHub today; gitlab/bitbucket
// equivalents can plug in here later). Optionally auto-merge after
// creation. Both steps best-effort: missing `gh` returns a typed
// reason so the caller can surface a friendly skip event instead of
// a stack trace.
export async function createPullRequest(input: {
  worktreePath: string;
  branch: string;
  title: string;
  body: string;
  autoMerge: boolean;
}): Promise<{ ok: boolean; url?: string; merged?: boolean; error?: string; detail?: string }> {
  const ghCheck = await execa("which", ["gh"], { reject: false });
  if (ghCheck.exitCode !== 0) {
    return { ok: false, error: "gh_not_installed" };
  }
  const create = await execa(
    "gh",
    ["pr", "create", "--head", input.branch, "--title", input.title, "--body", input.body],
    { cwd: input.worktreePath, reject: false },
  );
  if (create.exitCode !== 0) {
    const detail = (create.stderr || create.stdout).trim().slice(0, 500);
    // gh prints "a pull request for branch X already exists" when re-running.
    // Treat that as a non-fatal recovery: look up the URL and continue.
    if (/already exists/i.test(detail)) {
      const view = await execa("gh", ["pr", "view", "--json", "url", "-q", ".url"], {
        cwd: input.worktreePath,
        reject: false,
      });
      const url = view.exitCode === 0 ? view.stdout.trim() : undefined;
      const merged = input.autoMerge ? await mergeViaGh(input.worktreePath) : false;
      const result: { ok: boolean; merged: boolean; url?: string } = { ok: true, merged };
      if (url) result.url = url;
      return result;
    }
    return { ok: false, error: "gh_pr_create_failed", detail };
  }
  // gh prints the PR url on stdout's last line.
  const url = create.stdout.trim().split("\n").pop()?.trim();
  let merged = false;
  if (input.autoMerge) {
    merged = await mergeViaGh(input.worktreePath);
  }
  const out: { ok: boolean; merged: boolean; url?: string } = { ok: true, merged };
  if (url) out.url = url;
  return out;
}

async function mergeViaGh(cwd: string): Promise<boolean> {
  // --auto leverages branch protection / required checks where set;
  // when nothing is gating, --squash --merge merges immediately.
  const merge = await execa("gh", ["pr", "merge", "--squash", "--auto"], { cwd, reject: false });
  return merge.exitCode === 0;
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
