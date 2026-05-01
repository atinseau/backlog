import fs from "node:fs";
import path from "node:path";
import { execa } from "execa";
import type { Agent, Run, SubTask, Task } from "@backlog/schemas";
import { appendRunEvent, getRunDirectory, updateRunStatus, writeRunHandoff } from "./run-store.js";
import { completeRun, failRun } from "./run-service.js";

function buildEnv(agent: Agent, run: Run, task: SubTask, workItem: Task): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...agent.environment,
    BACKLOG_RUN_ID: run.id,
    BACKLOG_TASK_ID: workItem.id,
    BACKLOG_SUBTASK_ID: task.id,
    BACKLOG_REPO: run.repo,
    BACKLOG_BRANCH: run.branch,
    BACKLOG_WORKTREE: run.worktree_path,
  };
}

export async function executeCustomAgentRun(params: {
  backlogDir: string;
  run: Run;
  task: SubTask;
  workItem: Task;
  agent: Agent;
}): Promise<void> {
  if (!params.agent.command) {
    throw new Error(`Custom agent ${params.agent.id} is missing a command.`);
  }

  appendRunEvent(params.backlogDir, params.run.id, {
    ts: new Date().toISOString(),
    type: "executor.start",
    message: `Executing custom command for ${params.agent.id}`,
  });

  try {
    const result = await execa(params.agent.command, {
      cwd: params.run.worktree_path,
      env: buildEnv(params.agent, params.run, params.task, params.workItem),
      shell: true,
      reject: false,
    });

    const scratchDir = params.run.execution_mode === "direct"
      ? getRunDirectory(params.backlogDir, params.run.id)
      : params.run.worktree_path;
    const logPath = path.join(scratchDir, params.run.execution_mode === "direct" ? "executor.log" : ".backlog-executor.log");
    fs.writeFileSync(
      logPath,
      [`# stdout`, result.stdout, ``, `# stderr`, result.stderr].join("\n"),
      "utf8",
    );

    if (result.exitCode === 0) {
      await completeRun(params.backlogDir, params.run.id, `Custom agent ${params.agent.id} completed successfully`);
      appendRunEvent(params.backlogDir, params.run.id, {
        ts: new Date().toISOString(),
        type: "executor.success",
        message: `Custom command exited successfully`,
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
        `Reason: custom agent command failed`,
        "",
        `Exit code: ${String(result.exitCode)}`,
        "",
        params.run.execution_mode === "direct"
          ? "Inspect `executor.log` in the run directory for stdout/stderr."
          : "Inspect `.backlog-executor.log` in the worktree for stdout/stderr.",
      ].join("\n"),
    );
    await failRun(params.backlogDir, params.run.id, `Custom agent ${params.agent.id} failed with exit code ${String(result.exitCode)}`);
    appendRunEvent(params.backlogDir, params.run.id, {
      ts: new Date().toISOString(),
      type: "executor.failed",
      message: `Custom command failed. Handoff: ${handoffPath}`,
    });
  } catch (error) {
    updateRunStatus(params.backlogDir, params.run.id, "blocked", error instanceof Error ? error.message : String(error));
    throw error;
  }
}
