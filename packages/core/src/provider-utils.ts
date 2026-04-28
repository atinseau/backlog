import fs from "node:fs";
import path from "node:path";
import type { Agent, Artifact, Run, SubTask, Task } from "@backlog/schemas";
import { execa } from "execa";

export function buildProviderEnv(agent: Agent, run: Run, task: SubTask, workItem: Task): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...agent.environment,
    BACKLOG_RUN_ID: run.id,
    BACKLOG_TASK_ID: task.id,
    BACKLOG_WORK_ITEM_ID: workItem.id,
    BACKLOG_REPO: run.repo,
    BACKLOG_BRANCH: run.branch,
    BACKLOG_WORKTREE: run.worktree_path,
  };
}

export function buildProviderPrompt(task: SubTask, workItem: Task): string {
  const lines = [
    "You are executing one Backlog coding task in an isolated git worktree.",
    "Stay within the declared scope whenever possible.",
    "",
    `Work item: ${workItem.id}`,
    `Work item title: ${workItem.title}`,
    `SubTask: ${task.id}`,
    `SubTask title: ${task.title}`,
    `Repo: ${task.repo}`,
    `Risk: ${task.risk}`,
    "",
    "Allowed scopes:",
    ...(task.scopes.length > 0 ? task.scopes.map((scope) => `- ${scope}`) : ["- **"]),
    "",
    "Dependencies:",
    ...(task.depends_on.length > 0 ? task.depends_on.map((dependency) => `- ${dependency}`) : ["- none"]),
    "",
    "Completion criteria:",
    ...(task.completion.done_when.length > 0 ? task.completion.done_when.map((item) => `- ${item}`) : ["- complete the task safely and summarize what changed"]),
    "",
    "Instructions:",
    "- inspect the repo state before editing",
    "- make the smallest coherent set of changes needed",
    "- run relevant validation if practical",
    "- end with a concise summary of what changed and any follow-up risk",
  ];

  if (workItem.description) {
    lines.splice(5, 0, `Work item description: ${workItem.description}`);
  }
  if (workItem.acceptance_criteria.length > 0) {
    lines.push("", "Work item acceptance criteria:", ...workItem.acceptance_criteria.map((item) => `- ${item}`));
  }

  return lines.join("\n");
}

export async function collectWorktreeArtifacts(worktreePath: string): Promise<Artifact[]> {
  const artifacts: Artifact[] = [];

  const status = await execa("git", ["status", "--short", "--porcelain"], {
    cwd: worktreePath,
    reject: false,
  });
  for (const line of status.stdout.split("\n").map((entry) => entry.trim()).filter(Boolean)) {
    const file = line.slice(3).trim();
    if (file.length > 0) {
      artifacts.push({ kind: "file", value: file });
    }
  }

  const head = await execa("git", ["rev-parse", "HEAD"], {
    cwd: worktreePath,
    reject: false,
  });
  if (head.exitCode === 0 && head.stdout.trim().length > 0) {
    artifacts.push({ kind: "commit", value: head.stdout.trim() });
  }

  const diff = await execa("git", ["diff", "--binary"], {
    cwd: worktreePath,
    reject: false,
  });
  if (diff.stdout.trim().length > 0) {
    const patchPath = path.join(worktreePath, ".backlog-run.patch");
    fs.writeFileSync(patchPath, diff.stdout, "utf8");
    artifacts.push({ kind: "patch", value: ".backlog-run.patch" });
  }

  return artifacts;
}

export function successModeForAgent(agent: Agent): "review" | "complete" {
  if (agent.success_mode) {
    return agent.success_mode;
  }
  if (agent.provider === "codex" || agent.provider === "claude") {
    return "review";
  }
  return "complete";
}

// Wrap the base prompt with feedback from a prior failed attempt.
// Used by the retry policy to give the agent a fresh shot with the
// previous run's stderr/handoff content as context. Without this the
// agent would just repeat its mistake.
export function buildRetryPrompt(
  basePrompt: string,
  attemptNumber: number,
  previousFeedback: string,
): string {
  return [
    basePrompt,
    "",
    "---",
    `IMPORTANT: This is retry attempt ${attemptNumber}. The previous attempt`,
    "FAILED. Read the feedback below carefully — do NOT repeat the same",
    "mistake. If the failure looks unrecoverable from your side (rate",
    "limits, missing tooling, environment problems), say so explicitly",
    "in your summary so the human can intervene.",
    "",
    "Previous attempt's failure context:",
    "```",
    previousFeedback.trim(),
    "```",
  ].join("\n");
}
