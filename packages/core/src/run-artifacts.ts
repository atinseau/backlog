import fs from "node:fs";
import path from "node:path";
import { execa } from "execa";
import type { Agent, Artifact, ProjectConfig } from "@backlog/schemas";
import type { ExecutionTarget } from "./execution-target.js";
import { parsePorcelainPaths } from "./git-status.js";

// What a finished run leaves behind: the files it touched, the commit it sat
// on, and a patch of its uncommitted work.

const PATCH_FILE = ".backlog-run.patch";

/**
 * @param scratchDir where the patch file is written. Default: the worktree —
 * which a terminal run's worktree GC force-removes, taking the patch with it,
 * so a caller that wants the patch to outlive the run passes the run's own
 * directory instead. The artifact's `value` stays the bare file name either
 * way: the run directory is *renamed* when the run is archived, so an absolute
 * path recorded here would be stale by the time anyone read it.
 */
export async function collectWorktreeArtifacts(
  worktreePath: string,
  options?: { scratchDir?: string },
): Promise<Artifact[]> {
  const artifacts: Artifact[] = [];
  const git = (args: string[]) => execa("git", args, { cwd: worktreePath, reject: false });

  const status = await git(["status", "--short", "--porcelain"]);
  for (const file of parsePorcelainPaths(status.stdout)) {
    artifacts.push({ kind: "file", value: file });
  }

  const head = await git(["rev-parse", "HEAD"]);
  if (head.exitCode === 0 && head.stdout.trim()) {
    artifacts.push({ kind: "commit", value: head.stdout.trim() });
  }

  const diff = await git(["diff", "--binary"]);
  if (diff.stdout.trim()) {
    fs.writeFileSync(path.join(options?.scratchDir ?? worktreePath, PATCH_FILE), diff.stdout, "utf8");
    artifacts.push({ kind: "patch", value: PATCH_FILE });
  }

  return artifacts;
}

/**
 * Whether a successful run lands as done or parks for a human. The subtask's
 * own requirement wins; the agent's default only applies when there is no
 * subtask to ask.
 */
export function successModeForAgent(
  agent: Agent,
  task?: ExecutionTarget,
  _config?: ProjectConfig,
): "review" | "complete" {
  if (task) {
    return task.execution.manual_approval_required ? "review" : "complete";
  }
  return agent.success_mode ?? "complete";
}
