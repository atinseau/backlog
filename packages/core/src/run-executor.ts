import fs from "node:fs";
import path from "node:path";
import { loadConfig, getSecret } from "@backlog/config";
import type { Agent, Run, Task } from "@backlog/schemas";
import type { ExecutionTarget } from "./execution-target.js";
import { providerFor } from "./providers/index.js";
import { expandedPath } from "./providers/process.js";
import type { AgentProvider, ProviderRunResult } from "./providers/types.js";
import { collectWorktreeArtifacts, successModeForAgent } from "./run-artifacts.js";
import { buildProviderPrompt, buildRetryPrompt } from "./run-prompt.js";
import { getRepo } from "./repo-service.js";
import { failRun, finalizeSuccessfulRun } from "./run-service.js";
import { addRunArtifact, appendRunEvent, getRunDirectory, updateRunStatus, writeRunHandoff } from "./run-store.js";
import { recordUsage } from "./usage.js";

// One pipeline for every runtime. The provider owns the conversation with the
// model; everything around it — prompt assembly, the event stream, artifacts,
// usage accounting, run finalization — is identical whatever is running, and
// lives here instead of being copy-pasted per executor.

export const PROMPT_FILE = ".backlog-agent-prompt.md";
export const LOG_FILE = ".backlog-agent.log";

export interface ExecuteAgentRunParams {
  backlogDir: string;
  run: Run;
  task: ExecutionTarget;
  workItem: Task;
  agent: Agent;
  /** Tail of the previous attempt's events, threaded in by the retry policy. */
  priorFailureFeedback?: string;
  /** 1-indexed. Above 1, the prompt gets the "this is a retry" framing. */
  attemptNumber?: number;
}

/**
 * Repository access policy beats the agent's own sandbox setting: the policy
 * belongs to the resource being touched, not to the runner. A read-only
 * repository coerces the agent; a no-access one refuses the run outright.
 */
function applyRepoAccessPolicy(params: ExecuteAgentRunParams): ExecuteAgentRunParams {
  const accessMode = getRepo(params.backlogDir, params.task.repo)?.access_mode ?? "read-write";
  if (accessMode === "no-access") {
    throw new Error(`Repository ${params.task.repo} is set to no-access; runs are not allowed.`);
  }
  if (accessMode === "read-only") {
    return { ...params, agent: { ...params.agent, sandbox_mode: "read-only" } };
  }
  return params;
}

function promptFor(params: ExecuteAgentRunParams): string {
  const base = buildProviderPrompt(params.task, params.workItem, { executionMode: params.run.execution_mode });
  const attempt = params.attemptNumber ?? 1;
  return params.priorFailureFeedback && attempt > 1
    ? buildRetryPrompt(base, attempt, params.priorFailureFeedback)
    : base;
}

/**
 * Where a runtime may leave prompt, log and patch files. In worktree mode
 * that is the worktree itself (they are stripped before the agent's commit);
 * in direct mode it is the run directory, so the user's checkout stays clean.
 */
function scratchDirFor(params: ExecuteAgentRunParams): string {
  return params.run.execution_mode === "direct"
    ? getRunDirectory(params.backlogDir, params.run.id)
    : params.run.worktree_path;
}

function environmentFor(params: ExecuteAgentRunParams): NodeJS.ProcessEnv {
  const { run, task, workItem, agent } = params;
  return {
    ...process.env,
    PATH: expandedPath(),
    ...agent.environment,
    BACKLOG_RUN_ID: run.id,
    BACKLOG_TASK_ID: workItem.id,
    BACKLOG_SUBTASK_ID: task.id,
    BACKLOG_TARGET_TYPE: task.target_type ?? "subtask",
    BACKLOG_TARGET_ID: task.id,
    BACKLOG_REPO: run.repo,
    BACKLOG_BRANCH: run.branch,
    BACKLOG_WORKTREE: run.worktree_path,
    ...(agent.sandbox_mode ? { BACKLOG_SANDBOX_MODE: agent.sandbox_mode } : {}),
  };
}

function recordProviderUsage(params: ExecuteAgentRunParams, result: ProviderRunResult): void {
  if (!result.usage) return;
  try {
    recordUsage(params.backlogDir, params.run.id, {
      provider: params.agent.provider === "codex" ? "codex" : "anthropic",
      model: result.usage.model,
      input_tokens: result.usage.input_tokens,
      output_tokens: result.usage.output_tokens,
      ...(result.usage.cache_read_input_tokens !== undefined
        ? { cache_read_input_tokens: result.usage.cache_read_input_tokens }
        : {}),
      ...(result.usage.cache_creation_input_tokens !== undefined
        ? { cache_creation_input_tokens: result.usage.cache_creation_input_tokens }
        : {}),
    });
  } catch {
    // Usage is reporting, not correctness. Never fail a run over it.
  }
}

async function collectArtifacts(params: ExecuteAgentRunParams, scratchDir: string, logPath: string): Promise<void> {
  const isDirect = params.run.execution_mode === "direct";
  addRunArtifact(params.backlogDir, params.run.id, {
    kind: "log",
    value: isDirect ? logPath : LOG_FILE,
  });
  for (const artifact of await collectWorktreeArtifacts(
    params.run.worktree_path,
    isDirect ? { scratchDir } : undefined,
  )) {
    addRunArtifact(params.backlogDir, params.run.id, artifact);
  }
}

async function handleFailure(
  params: ExecuteAgentRunParams,
  provider: AgentProvider,
  result: ProviderRunResult,
): Promise<void> {
  const failure = result.failure ?? "unknown failure";
  const handoffPath = writeRunHandoff(
    params.backlogDir,
    params.run.id,
    [
      "# Run Handoff",
      "",
      `Run: ${params.run.id}`,
      `Reason: ${provider.describe().displayName} execution failed`,
      "",
      `Exit: ${failure}`,
      "",
      params.run.execution_mode === "direct"
        ? `Inspect \`${LOG_FILE}\` in the run directory.`
        : `Inspect \`${LOG_FILE}\` in the execution workspace.`,
    ].join("\n"),
  );
  await failRun(
    params.backlogDir,
    params.run.id,
    result.summary || `Agent ${params.agent.id} failed (${failure})`,
  );
  appendRunEvent(params.backlogDir, params.run.id, {
    ts: new Date().toISOString(),
    type: "executor.failed",
    message: `Execution failed (${failure}). Handoff: ${handoffPath}`,
  });
}

/**
 * Run one agent against one subtask.
 * @returns false when the agent's provider is unknown, so the caller can
 * report a typed skip rather than treating the no-op as success.
 */
export async function executeAgentRun(rawParams: ExecuteAgentRunParams): Promise<boolean> {
  const params = applyRepoAccessPolicy(rawParams);
  const provider = providerFor(params.agent.provider);
  if (!provider?.executeRun) return false;

  const { backlogDir, run } = params;
  const scratchDir = scratchDirFor(params);
  const logPath = path.join(scratchDir, LOG_FILE);
  const prompt = promptFor(params);
  fs.writeFileSync(path.join(scratchDir, PROMPT_FILE), prompt, "utf8");

  appendRunEvent(backlogDir, run.id, {
    ts: new Date().toISOString(),
    type: "executor.start",
    message: `Executing ${provider.describe().displayName} run for ${params.agent.id}`,
  });

  try {
    const result = await provider.executeRun({
      agent: params.agent,
      prompt,
      cwd: run.worktree_path,
      scratchDir,
      env: environmentFor(params),
      ...(run.reasoning_effort ? { reasoningEffort: run.reasoning_effort } : {}),
      getSecret: (key) => getSecret(backlogDir, key),
      onActivity: (event) => {
        appendRunEvent(backlogDir, run.id, { ts: new Date().toISOString(), ...event });
      },
    });

    fs.writeFileSync(logPath, ["# stdout", result.stdout, "", "# stderr", result.stderr].join("\n"), "utf8");
    recordProviderUsage(params, result);
    if (result.summary) {
      addRunArtifact(backlogDir, run.id, { kind: "summary", value: result.summary });
    }
    await collectArtifacts(params, scratchDir, logPath);

    if (!result.ok) {
      await handleFailure(params, provider, result);
      return true;
    }

    const successMode = successModeForAgent(params.agent, params.task, loadConfig(backlogDir));
    await finalizeSuccessfulRun(
      backlogDir,
      run.id,
      result.summary || `Agent ${params.agent.id} completed successfully`,
      successMode,
    );
    appendRunEvent(backlogDir, run.id, {
      ts: new Date().toISOString(),
      type: "executor.success",
      message: `Execution completed with success mode ${successMode}`,
    });
    return true;
  } catch (error) {
    updateRunStatus(backlogDir, run.id, "blocked", error instanceof Error ? error.message : String(error));
    throw error;
  }
}
