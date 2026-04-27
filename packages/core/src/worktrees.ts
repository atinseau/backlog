import fs from "node:fs";
import path from "node:path";
import { detectGitDir, git } from "@backlog/git";
import type { ProjectConfig } from "@backlog/schemas";
import { listActiveRuns, listArchivedRuns } from "./run-store.js";

function worktreesRoot(backlogDir: string): string {
  return path.join(backlogDir, "worktrees");
}

export function buildRunBranchName(taskId: string, taskTitle: string): string {
  const slug = taskTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32);
  return `backlog/${taskId}-${slug || "task"}`;
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

export function listKnownWorktrees(backlogDir: string): KnownWorktree[] {
  const active = listActiveRuns(backlogDir).map((run) => ({
    runId: run.id,
    repo: run.repo,
    branch: run.branch,
    status: run.status,
    path: run.worktree_path,
    exists: fs.existsSync(run.worktree_path),
    active: true,
  }));
  const archived = listArchivedRuns(backlogDir).map((run) => ({
    runId: run.id,
    repo: run.repo,
    branch: run.branch,
    status: run.status,
    path: run.worktree_path,
    exists: fs.existsSync(run.worktree_path),
    active: false,
  }));
  return [...active, ...archived];
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
  const repoPaths = new Map(config.repos.map((repo) => [repo.id, repo.path]));
  const archivedRuns = listArchivedRuns(backlogDir);
  const activeRuns = listActiveRuns(backlogDir);

  for (const run of activeRuns) {
    if (run.status === "running" || run.status === "preparing" || run.status === "awaiting_review") {
      result.skipped.push(run.worktree_path);
      continue;
    }
  }

  for (const run of archivedRuns) {
    if (!fs.existsSync(run.worktree_path)) {
      continue;
    }
    const repoPath = repoPaths.get(run.repo);
    if (!repoPath) {
      result.skipped.push(run.worktree_path);
      continue;
    }
    if (!options?.dryRun) {
      await git(["worktree", "remove", "--force", run.worktree_path], repoPath);
    }
    result.removed.push(run.worktree_path);
  }

  return result;
}
