import type { Run, Task, Agent } from "@backlog/schemas";
import { supportsAgentExecution } from "./agents.js";
import { executeClaudeAgentRun } from "./claude-executor.js";
import { executeCodexAgentRun } from "./codex-executor.js";
import { executeCustomAgentRun } from "./custom-executor.js";
import type { ExecutionTarget } from "./execution-target.js";
import { getRepo } from "./repo-service.js";

export { supportsAgentExecution };

export interface ExecuteAgentRunParams {
  backlogDir: string;
  run: Run;
  task: ExecutionTarget;
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

// Repository-level access policy (config.repos[].access_mode) takes
// precedence over the agent's own sandbox_mode setting. Read-only and
// no-access repos coerce / refuse the run regardless of what the
// agent thinks it's allowed to do — the policy lives with the
// resource being touched, not with the runner.
function applyRepoAccessPolicy(params: ExecuteAgentRunParams): ExecuteAgentRunParams {
  const repo = getRepo(params.backlogDir, params.task.repo);
  const accessMode = repo?.access_mode ?? "read-write";
  if (accessMode === "no-access") {
    throw new Error(`Repository ${params.task.repo} is set to no-access; runs are not allowed.`);
  }
  if (accessMode === "read-only") {
    // Replace the sandbox_mode with read-only on a shallow copy of the
    // agent. Keeps the persisted agent config untouched (the user's
    // chosen sandbox_mode is a default, not a guarantee).
    const agent: Agent = { ...params.agent, sandbox_mode: "read-only" };
    return { ...params, agent };
  }
  return params;
}

export async function executeAgentRun(rawParams: ExecuteAgentRunParams): Promise<boolean> {
  const params = applyRepoAccessPolicy(rawParams);
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
