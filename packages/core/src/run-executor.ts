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
import { addRunArtifact, appendRunEvent, updateRunStatus, writeRunHandoff } from "./run-store.js";
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
 * Repository access policy belongs to the resource being touched, not to the
 * runner: a no-access repository refuses the run outright.
 */
function applyRepoAccessPolicy(params: ExecuteAgentRunParams): ExecuteAgentRunParams {
  const accessMode = getRepo(params.backlogDir, params.task.repo)?.access_mode ?? "read-write";
  if (accessMode === "no-access") {
    throw new Error(`Repository ${params.task.repo} is set to no-access; runs are not allowed.`);
  }
  return params;
}

function promptFor(params: ExecuteAgentRunParams): string {
  const base = buildProviderPrompt(params.task, params.workItem);
  const attempt = params.attemptNumber ?? 1;
  return params.priorFailureFeedback && attempt > 1
    ? buildRetryPrompt(base, attempt, params.priorFailureFeedback)
    : base;
}

function environmentFor(params: ExecuteAgentRunParams): NodeJS.ProcessEnv {
  const { run, task, workItem, agent } = params;
  const targetType = task.target_type ?? "subtask";
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: expandedPath(),
    ...agent.environment,
    // An in_repo project tracks .backlog/config.toml, so the run's worktree
    // carries a shadow copy of it. Without this, findProject() walking up from
    // the worktree resolves to that shadow: the agent would read an empty
    // project and write its trace into a directory the worktree GC deletes.
    // BACKLOG_PROJECT_DIR is checked before the upward walk (find-project.ts).
    BACKLOG_PROJECT_DIR: params.backlogDir,
    BACKLOG_RUN_ID: run.id,
    BACKLOG_TASK_ID: workItem.id,
    // Only a subtask-scoped run has a subtask. A task dispatched directly (no
    // split) carries a *task* id in ExecutionTarget.id, and exporting that as
    // BACKLOG_SUBTASK_ID made every consumer look up a subtask that cannot
    // exist: `trace_write` and `backlog trace write` both died on
    // "Unknown subtask: task_xxx" for that whole class of runs. The target's
    // identity is not lost — BACKLOG_TARGET_TYPE / BACKLOG_TARGET_ID carry it.
    ...(targetType === "subtask" ? { BACKLOG_SUBTASK_ID: task.id } : {}),
    BACKLOG_TARGET_TYPE: targetType,
    BACKLOG_TARGET_ID: task.id,
    BACKLOG_REPO: run.repo,
    BACKLOG_BRANCH: run.branch,
    BACKLOG_WORKTREE: run.worktree_path,
  };
  // Two inherited values have to be removed rather than merely not written,
  // because `...process.env` is spread in above.
  //
  // BACKLOG_SUBTASK_ID: a task-level run has no subtask, and an inherited value
  // would make every consumer look one up that cannot exist.
  //
  // BACKLOG_AGENT_ROLE: the role is what closes the Backlog CLI to this agent,
  // and it is only justified where the MCP façade replaces the CLI. This
  // pipeline is runtime-agnostic and cannot know whether that happened, so it
  // stamps nothing and lets the runtime that hands the façade out stamp it —
  // `executionCliRole` in providers/claude-code/provider.ts. Clearing it here
  // keeps that the only source: a role inherited from the shell Backlog was
  // started in must not stand in for a façade nobody handed out.
  if (targetType !== "subtask") {
    delete env.BACKLOG_SUBTASK_ID;
  }
  delete env.BACKLOG_AGENT_ROLE;
  return env;
}

function recordProviderUsage(params: ExecuteAgentRunParams, result: ProviderRunResult): void {
  if (!result.usage) return;
  try {
    recordUsage(params.backlogDir, params.run.id, {
      provider: "anthropic",
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

async function collectArtifacts(params: ExecuteAgentRunParams): Promise<void> {
  addRunArtifact(params.backlogDir, params.run.id, {
    kind: "log",
    value: LOG_FILE,
  });
  for (const artifact of await collectWorktreeArtifacts(params.run.worktree_path)) {
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
      `Inspect \`${LOG_FILE}\` in the execution workspace.`,
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
  const scratchDir = run.worktree_path;
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
      backlogDir,
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
    await collectArtifacts(params);

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
