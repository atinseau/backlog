import fs from "node:fs";
import path from "node:path";
import { execa } from "execa";
import type { Agent, Artifact, ProjectConfig } from "@backlog/schemas";
import type { ExecutionTarget } from "./execution-target.js";

// What a finished run leaves behind: the files it touched, the commit it sat
// on, and a patch of its uncommitted work.

export async function collectWorktreeArtifacts(
  worktreePath: string,
  options?: { scratchDir?: string },
): Promise<Artifact[]> {
  const artifacts: Artifact[] = [];
  const git = (args: string[]) => execa("git", args, { cwd: worktreePath, reject: false });

  const status = await git(["status", "--short", "--porcelain"]);
  for (const line of status.stdout.split("\n")) {
    const file = line.trim().slice(3).trim();
    if (file.length > 0) {
      artifacts.push({ kind: "file", value: file });
    }
  }

  const head = await git(["rev-parse", "HEAD"]);
  if (head.exitCode === 0 && head.stdout.trim()) {
    artifacts.push({ kind: "commit", value: head.stdout.trim() });
  }

  const diff = await git(["diff", "--binary"]);
  if (diff.stdout.trim()) {
    const patchPath = path.join(options?.scratchDir ?? worktreePath, ".backlog-run.patch");
    fs.writeFileSync(patchPath, diff.stdout, "utf8");
    artifacts.push({ kind: "patch", value: options?.scratchDir ? patchPath : ".backlog-run.patch" });
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
