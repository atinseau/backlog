import type { Agent, Run, SubTask, Task } from "@backlog/schemas";
import { executeClaudeAgentRun } from "./claude-executor.js";
import { executeCodexAgentRun } from "./codex-executor.js";
import { executeCustomAgentRun } from "./custom-executor.js";

export function supportsAgentExecution(agent: Agent): boolean {
  if (agent.provider === "custom") {
    return Boolean(agent.command);
  }
  if (agent.provider === "codex" || agent.provider === "claude") {
    return true;
  }
  return false;
}

export interface ExecuteAgentRunParams {
  backlogDir: string;
  run: Run;
  task: SubTask;
  workItem: Task;
  agent: Agent;
  // Set on retry attempts. Threaded into the executor so the agent
  // can see what its previous attempt looked like and avoid
  // repeating the same mistake.
  priorFailureFeedback?: string;
  // 1-indexed, set by the retry loop. When > 1, the executor wraps
  // the prompt in the "this is a retry" framing.
  attemptNumber?: number;
}

export async function executeAgentRun(params: ExecuteAgentRunParams): Promise<boolean> {
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
