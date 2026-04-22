import fs from "node:fs";
import path from "node:path";
import { execa } from "execa";
import type { Agent, Run, Task, WorkItem } from "@cockpit-ai/schemas";
import { appendRunEvent, updateRunStatus, writeRunHandoff } from "./run-store.js";
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

export async function executeCustomAgentRun(params: {
  cockpitDir: string;
  run: Run;
  task: Task;
  workItem: WorkItem;
  agent: Agent;
}): Promise<void> {
  if (!params.agent.command) {
    throw new Error(`Custom agent ${params.agent.id} is missing a command.`);
  }

  appendRunEvent(params.cockpitDir, params.run.id, {
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

    const logPath = path.join(params.run.worktree_path, ".cockpit-executor.log");
    fs.writeFileSync(
      logPath,
      [`# stdout`, result.stdout, ``, `# stderr`, result.stderr].join("\n"),
      "utf8",
    );

    if (result.exitCode === 0) {
      completeRun(params.cockpitDir, params.run.id, `Custom agent ${params.agent.id} completed successfully`);
      appendRunEvent(params.cockpitDir, params.run.id, {
        ts: new Date().toISOString(),
        type: "executor.success",
        message: `Custom command exited successfully`,
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
        `Reason: custom agent command failed`,
        "",
        `Exit code: ${String(result.exitCode)}`,
        "",
        "Inspect `.cockpit-executor.log` in the worktree for stdout/stderr.",
      ].join("\n"),
    );
    failRun(params.cockpitDir, params.run.id, `Custom agent ${params.agent.id} failed with exit code ${String(result.exitCode)}`);
    appendRunEvent(params.cockpitDir, params.run.id, {
      ts: new Date().toISOString(),
      type: "executor.failed",
      message: `Custom command failed. Handoff: ${handoffPath}`,
    });
  } catch (error) {
    updateRunStatus(params.cockpitDir, params.run.id, "blocked", error instanceof Error ? error.message : String(error));
    throw error;
  }
}
