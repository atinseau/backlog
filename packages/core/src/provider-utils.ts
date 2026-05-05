import fs from "node:fs";
import path from "node:path";
import type { Agent, Artifact, ProjectConfig, Run, SubTask, Task } from "@backlog/schemas";
import { execa } from "execa";
import { getSecret } from "@backlog/config";

// Provider env vars sourced from the workspace's encrypted secrets
// store. Each entry maps a project secret key → the env var the
// provider's CLI expects. We only inject when the env var isn't
// already set (process.env wins so users can still override per-run
// via shell). Anthropic / OpenAI are the active set; add others here
// when new providers ship.
const PROVIDER_SECRET_ENV_MAP: Record<string, string> = {
  ANTHROPIC_API_KEY: "ANTHROPIC_API_KEY",
  OPENAI_API_KEY: "OPENAI_API_KEY",
};

function commonExecutableDirs(): string[] {
  const home = process.env.HOME;
  return [
    ...(process.env.PATH ?? "").split(path.delimiter).filter(Boolean),
    ...(home ? [
      path.join(home, ".local", "bin"),
      path.join(home, "bin"),
      path.join(home, ".npm-global", "bin"),
    ] : []),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
  ];
}

function expandedPath(): string {
  return Array.from(new Set(commonExecutableDirs())).join(path.delimiter);
}

function executableCandidates(command: string): string[] {
  if (command.includes("/") || command.includes(path.sep)) return [command];
  return commonExecutableDirs().map((dir) => path.join(dir, command));
}

function isExecutable(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveExecutable(command: string): string {
  if (command.trim().includes(" ")) return command;
  return executableCandidates(command).find(isExecutable) ?? command;
}

export function executableExists(command: string): boolean {
  return executableCandidates(command).some(isExecutable);
}

export function buildProviderEnv(
  agent: Agent,
  run: Run,
  task: SubTask,
  workItem: Task,
  backlogDir?: string,
): NodeJS.ProcessEnv {
  // Workspace secrets layered before process.env so they're picked up
  // when the user set their key via the UI (Settings → Project → API
  // keys) or `backlog secrets set`. process.env still wins so a shell
  // override remains possible for one-off debugging.
  const secretsEnv: NodeJS.ProcessEnv = {};
  if (backlogDir) {
    for (const [secretKey, envVar] of Object.entries(PROVIDER_SECRET_ENV_MAP)) {
      const value = getSecret(backlogDir, secretKey);
      if (value) secretsEnv[envVar] = value;
    }
  }
  return {
    ...secretsEnv,
    ...process.env,
    PATH: expandedPath(),
    ...agent.environment,
    BACKLOG_RUN_ID: run.id,
    BACKLOG_TASK_ID: workItem.id,
    BACKLOG_SUBTASK_ID: task.id,
    BACKLOG_REPO: run.repo,
    BACKLOG_BRANCH: run.branch,
    BACKLOG_WORKTREE: run.worktree_path,
  };
}

export function buildProviderPrompt(
  task: SubTask,
  workItem: Task,
  options?: { executionMode?: Run["execution_mode"] },
): string {
  const direct = options?.executionMode === "direct";
  const lines = [
    direct
      ? "You are executing one Backlog coding task directly in the user's main checkout."
      : "You are executing one Backlog coding task in an isolated git worktree.",
    direct
      ? "Your file edits affect the user's working copy immediately. Stay within the declared scope."
      : "Stay within the declared scope whenever possible.",
    "",
    `Task: ${workItem.id}`,
    `Task title: ${workItem.title}`,
    `Subtask: ${task.id}`,
    `Subtask title: ${task.title}`,
    `Repository: ${task.repo}`,
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
    lines.splice(5, 0, `Task description: ${workItem.description}`);
  }
  if (workItem.acceptance_criteria.length > 0) {
    lines.push("", "Task acceptance criteria:", ...workItem.acceptance_criteria.map((item) => `- ${item}`));
  }

  return lines.join("\n");
}

export async function collectWorktreeArtifacts(
  worktreePath: string,
  options?: { scratchDir?: string },
): Promise<Artifact[]> {
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
    const patchPath = path.join(options?.scratchDir ?? worktreePath, ".backlog-run.patch");
    fs.writeFileSync(patchPath, diff.stdout, "utf8");
    artifacts.push({ kind: "patch", value: options?.scratchDir ? patchPath : ".backlog-run.patch" });
  }

  return artifacts;
}

export function successModeForAgent(agent: Agent, task?: SubTask, config?: ProjectConfig): "review" | "complete" {
  if (task) {
    if (task.execution.manual_approval_required) return "review";
    if (config?.review.show_review_column) return "review";
    return "complete";
  }
  if (agent.success_mode) {
    return agent.success_mode;
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
