import fs from "node:fs";
import path from "node:path";
import { execa } from "execa";
import type { Agent, Run, Task, WorkItem } from "@cockpit-ai/schemas";
import { addRunArtifact, appendRunEvent, updateRunStatus, writeRunHandoff } from "./run-store.js";
import { completeRun, failRun } from "./run-service.js";
import { buildProviderEnv, buildProviderPrompt, collectWorktreeArtifacts } from "./provider-utils.js";

export async function executeClaudeAgentRun(params: {
  cockpitDir: string;
  run: Run;
  task: Task;
  workItem: WorkItem;
  agent: Agent;
}): Promise<void> {
  const executable = params.agent.command || "claude";
  const prompt = buildProviderPrompt(params.task, params.workItem);
  const promptPath = path.join(params.run.worktree_path, ".cockpit-claude-prompt.md");
  const logPath = path.join(params.run.worktree_path, ".cockpit-claude.log");
  fs.writeFileSync(promptPath, prompt, "utf8");

  const args = ["-p", "--output-format", "text", "--permission-mode", "bypassPermissions"];
  if (params.agent.model) {
    args.push("--model", params.agent.model);
  }
  if (params.agent.profile) {
    args.push("--settings", JSON.stringify({ env: { CLAUDE_CODE_PROFILE: params.agent.profile } }));
  }
  args.push(prompt);

  appendRunEvent(params.cockpitDir, params.run.id, {
    ts: new Date().toISOString(),
    type: "executor.start",
    message: `Executing Claude run for ${params.agent.id}`,
  });

  try {
    const result = await execa(executable, args, {
      cwd: params.run.worktree_path,
      env: buildProviderEnv(params.agent, params.run, params.task, params.workItem),
      reject: false,
    });

    fs.writeFileSync(
      logPath,
      [`# stdout`, result.stdout, ``, `# stderr`, result.stderr].join("\n"),
      "utf8",
    );

    const summary = result.stdout.trim();
    if (summary) {
      addRunArtifact(params.cockpitDir, params.run.id, { kind: "summary", value: summary });
    }
    addRunArtifact(params.cockpitDir, params.run.id, { kind: "log", value: ".cockpit-claude.log" });
    for (const artifact of await collectWorktreeArtifacts(params.run.worktree_path)) {
      addRunArtifact(params.cockpitDir, params.run.id, artifact);
    }

    if (result.exitCode === 0) {
      await completeRun(
        params.cockpitDir,
        params.run.id,
        summary || `Claude agent ${params.agent.id} completed successfully`,
      );
      appendRunEvent(params.cockpitDir, params.run.id, {
        ts: new Date().toISOString(),
        type: "executor.success",
        message: "Claude execution completed successfully",
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
        "Reason: claude print execution failed",
        "",
        `Exit code: ${String(result.exitCode)}`,
        "",
        "Inspect `.cockpit-claude.log` in the worktree.",
      ].join("\n"),
    );
    await failRun(
      params.cockpitDir,
      params.run.id,
      summary || `Claude agent ${params.agent.id} failed with exit code ${String(result.exitCode)}`,
    );
    appendRunEvent(params.cockpitDir, params.run.id, {
      ts: new Date().toISOString(),
      type: "executor.failed",
      message: `Claude execution failed. Handoff: ${handoffPath}`,
    });
  } catch (error) {
    updateRunStatus(params.cockpitDir, params.run.id, "blocked", error instanceof Error ? error.message : String(error));
    throw error;
  }
}
