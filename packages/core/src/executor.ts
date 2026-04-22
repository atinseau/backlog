import type { Agent, Run, Task, WorkItem } from "@cockpit-ai/schemas";
import { executeClaudeAgentRun } from "./claude-executor.js";
import { executeCodexAgentRun } from "./codex-executor.js";
import { executeCustomAgentRun } from "./custom-executor.js";

export async function executeAgentRun(params: {
  cockpitDir: string;
  run: Run;
  task: Task;
  workItem: WorkItem;
  agent: Agent;
}): Promise<boolean> {
  if (params.agent.provider === "custom" && params.agent.command) {
    await executeCustomAgentRun(params);
    return true;
  }
  if (params.agent.provider === "codex") {
    await executeCodexAgentRun(params);
    return true;
  }
  if (params.agent.provider === "claude") {
    await executeClaudeAgentRun(params);
    return true;
  }
  return false;
}
