import fs from "node:fs";
import path from "node:path";
import { execa } from "execa";
import type { Agent, Run, Task, WorkItem } from "@cockpit-ai/schemas";
import { addRunArtifact, appendRunEvent, updateRunStatus, writeRunHandoff } from "./run-store.js";
import { completeRun, failRun } from "./run-service.js";

function buildEnv(agent: Agent, run: Run, task: Task, workItem: WorkItem): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...agent.environment,
    COCKPIT_RUN_ID: run.id,
    COCKPIT_TASK_ID: task.id,
    COCKPIT_WORK_ITEM_ID: workItem.id,
    COCKPIT_REPO: run.repo,
    COCKPIT_BRANCH: run.branch,
    COCKPIT_WORKTREE: run.worktree_path,
  };
}

function buildPrompt(task: Task, workItem: WorkItem): string {
  const lines = [
    "You are executing one Cockpit coding task in an isolated git worktree.",
    "Stay within the declared scope whenever possible.",
    "",
    `Work item: ${workItem.id}`,
    `Work item title: ${workItem.title}`,
    `Task: ${task.id}`,
    `Task title: ${task.title}`,
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

export async function executeCodexAgentRun(params: {
  cockpitDir: string;
  run: Run;
  task: Task;
  workItem: WorkItem;
  agent: Agent;
}): Promise<void> {
  const executable = params.agent.command || "codex";
  const prompt = buildPrompt(params.task, params.workItem);
  const promptPath = path.join(params.run.worktree_path, ".cockpit-codex-prompt.md");
  const outputPath = path.join(params.run.worktree_path, ".cockpit-codex-last-message.md");
  const logPath = path.join(params.run.worktree_path, ".cockpit-codex.log");
  fs.writeFileSync(promptPath, prompt, "utf8");

  const args = ["exec", "--skip-git-repo-check", "--json", "--output-last-message", outputPath];
  if (params.agent.model) {
    args.push("--model", params.agent.model);
  }
  if (params.agent.profile) {
    args.push("--profile", params.agent.profile);
  }
  if (params.agent.sandbox_mode) {
    args.push("--sandbox", params.agent.sandbox_mode);
  } else {
    args.push("--sandbox", "workspace-write");
  }
  args.push("--cd", params.run.worktree_path, "-");

  appendRunEvent(params.cockpitDir, params.run.id, {
    ts: new Date().toISOString(),
    type: "executor.start",
    message: `Executing Codex run for ${params.agent.id}`,
  });

  try {
    const result = await execa(executable, args, {
      cwd: params.run.worktree_path,
      env: buildEnv(params.agent, params.run, params.task, params.workItem),
      input: prompt,
      reject: false,
    });

    fs.writeFileSync(
      logPath,
      [`# stdout`, result.stdout, ``, `# stderr`, result.stderr].join("\n"),
      "utf8",
    );

    const lastMessage = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8").trim() : "";
    if (lastMessage) {
      addRunArtifact(params.cockpitDir, params.run.id, { kind: "summary", value: lastMessage });
    }

    if (result.exitCode === 0) {
      await completeRun(
        params.cockpitDir,
        params.run.id,
        lastMessage || `Codex agent ${params.agent.id} completed successfully`,
      );
      appendRunEvent(params.cockpitDir, params.run.id, {
        ts: new Date().toISOString(),
        type: "executor.success",
        message: "Codex execution completed successfully",
      });
      return;
    }

    const handoffPath = writeRunHandoff(
      params.cockpitDir,
      params.run.id,
      [
        "# Run Handoff",
        "",
        `Run: ${params.run.id}`,
        "Reason: codex exec failed",
        "",
        `Exit code: ${String(result.exitCode)}`,
        "",
        "Inspect `.cockpit-codex.log` and `.cockpit-codex-last-message.md` in the worktree.",
      ].join("\n"),
    );
    await failRun(
      params.cockpitDir,
      params.run.id,
      lastMessage || `Codex agent ${params.agent.id} failed with exit code ${String(result.exitCode)}`,
    );
    appendRunEvent(params.cockpitDir, params.run.id, {
      ts: new Date().toISOString(),
      type: "executor.failed",
      message: `Codex execution failed. Handoff: ${handoffPath}`,
    });
  } catch (error) {
    updateRunStatus(params.cockpitDir, params.run.id, "blocked", error instanceof Error ? error.message : String(error));
    throw error;
  }
}
