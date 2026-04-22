import fs from "node:fs";
import path from "node:path";
import { detectGitDir, git } from "@cockpit-ai/git";

function worktreesRoot(cockpitDir: string): string {
  return path.join(cockpitDir, "worktrees");
}

export function buildRunBranchName(taskId: string, taskTitle: string): string {
  const slug = taskTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32);
  return `cockpit/${taskId}-${slug || "task"}`;
}

export async function ensureWorktree(params: {
  cockpitDir: string;
  repoId: string;
  repoPath: string;
  branch: string;
  runId: string;
}): Promise<string> {
  const target = path.join(worktreesRoot(params.cockpitDir), params.repoId, params.runId);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  await git(["worktree", "add", "-b", params.branch, target], params.repoPath);
  return target;
}

export async function writeWorktreeContext(worktreePath: string, runId: string, claimId: string): Promise<void> {
  const gitDir = await detectGitDir(worktreePath);
  fs.writeFileSync(
    path.join(gitDir, "cockpit-context.json"),
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
