import fs from "node:fs";
import path from "node:path";
import { execa } from "execa";
import type { Agent, Run, SubTask, Task } from "@backlog/schemas";
import { addRunArtifact, appendRunEvent, updateRunStatus, writeRunHandoff } from "./run-store.js";
import { failRun, finalizeSuccessfulRun } from "./run-service.js";
import { buildProviderEnv, buildProviderPrompt, collectWorktreeArtifacts, successModeForAgent } from "./provider-utils.js";

export async function executeCodexAgentRun(params: {
  backlogDir: string;
  run: Run;
  task: SubTask;
  workItem: Task;
  agent: Agent;
}): Promise<void> {
  const executable = params.agent.command || "codex";
  const prompt = buildProviderPrompt(params.task, params.workItem);
  const promptPath = path.join(params.run.worktree_path, ".backlog-codex-prompt.md");
  const outputPath = path.join(params.run.worktree_path, ".backlog-codex-last-message.md");
  const logPath = path.join(params.run.worktree_path, ".backlog-codex.log");
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

  appendRunEvent(params.backlogDir, params.run.id, {
    ts: new Date().toISOString(),
    type: "executor.start",
    message: `Executing Codex run for ${params.agent.id}`,
  });

  try {
    const result = await execa(executable, args, {
      cwd: params.run.worktree_path,
      env: buildProviderEnv(params.agent, params.run, params.task, params.workItem),
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
      addRunArtifact(params.backlogDir, params.run.id, { kind: "summary", value: lastMessage });
    }
    addRunArtifact(params.backlogDir, params.run.id, { kind: "log", value: ".backlog-codex.log" });
    for (const artifact of await collectWorktreeArtifacts(params.run.worktree_path)) {
      addRunArtifact(params.backlogDir, params.run.id, artifact);
    }

    if (result.exitCode === 0) {
      await finalizeSuccessfulRun(
        params.backlogDir,
        params.run.id,
        lastMessage || `Codex agent ${params.agent.id} completed successfully`,
        successModeForAgent(params.agent),
      );
      appendRunEvent(params.backlogDir, params.run.id, {
        ts: new Date().toISOString(),
        type: "executor.success",
        message: `Codex execution completed with success mode ${successModeForAgent(params.agent)}`,
      });
      return;
    }

    const handoffPath = writeRunHandoff(
      params.backlogDir,
      params.run.id,
      [
        "# Run Handoff",
        "",
        `Run: ${params.run.id}`,
        "Reason: codex exec failed",
        "",
        `Exit code: ${String(result.exitCode)}`,
        "",
        "Inspect `.backlog-codex.log` and `.backlog-codex-last-message.md` in the worktree.",
      ].join("\n"),
    );
    await failRun(
      params.backlogDir,
      params.run.id,
      lastMessage || `Codex agent ${params.agent.id} failed with exit code ${String(result.exitCode)}`,
    );
    appendRunEvent(params.backlogDir, params.run.id, {
      ts: new Date().toISOString(),
      type: "executor.failed",
      message: `Codex execution failed. Handoff: ${handoffPath}`,
    });
  } catch (error) {
    updateRunStatus(params.backlogDir, params.run.id, "blocked", error instanceof Error ? error.message : String(error));
    throw error;
  }
}
