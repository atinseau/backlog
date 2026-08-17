import { loadConfig } from "@backlog/config";
import type { OrchestratorState, Run, SubTask, Task } from "@backlog/schemas";
import { runSubTaskId, runTargetId, runTargetType } from "./execution-target.js";
import { pauseOrchestrator, startOrchestrator, stopOrchestrator } from "./orchestrator-loop.js";
import { getOrchestratorState } from "./orchestrator-state.js";
import { startRunsForPlan } from "./run-launcher.js";
import { getRunEvents, listActiveRuns, loadRun } from "./run-store.js";
import { buildExecutionPlan } from "./scheduler.js";
import { listSubTasks, listTasks } from "./state-files.js";

// The tools that let a conversational agent inspect and drive the
// orchestrator. They live here, in core, because two very different callers
// serve them: the server's chat backend hands them to the Anthropic API, and
// the CLI exposes the same set over MCP for `claude -p`. Duplicating them
// would guarantee the two drift apart.

export interface OrchestratorTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** Tools that change state. Every one of them is gated on explicit confirmation. */
const WRITE_TOOLS = new Set([
  "start_orchestrator",
  "pause_orchestrator",
  "stop_orchestrator",
  "start_subtask",
]);

const CONFIRMED_PROPERTY = {
  confirmed: {
    type: "boolean",
    description: "Set to true ONLY after the user has explicitly approved this specific action in plain language.",
  },
} as const;

export const ORCHESTRATOR_TOOLS: OrchestratorTool[] = [
  {
    name: "list_runs",
    description:
      "List active runs (preparing/running/awaiting_review) in the project. Returns id, subtask_id, status, agent_id, branch, repo, started_at, last result line.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_run_events",
    description:
      "Return the last N lines of a run's events.ndjson — useful to see what an agent is doing right now. Lines are JSON objects with type/message/ts.",
    inputSchema: {
      type: "object",
      properties: {
        run_id: { type: "string", description: "Run id, e.g. run_001" },
        tail: { type: "integer", description: "Number of lines from the end (default 30, max 200)." },
      },
      required: ["run_id"],
    },
  },
  {
    name: "list_tasks",
    description:
      "List parent tasks and their subtasks with current status. Use this to answer 'what's queued', 'what's running', 'what's blocked'.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          description:
            "Filter by parent task status. One of: backlog, ready, in_progress, review, test, released, done, blocked, all.",
        },
      },
      required: [],
    },
  },
  {
    name: "get_orchestrator_state",
    description:
      "Get the orchestrator's current mode (idle/running/paused/stopping), tick interval, max_agents, last tick time, last error.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_git_settings",
    description:
      "Read the project's git settings: branch_strategy, merge_strategy, merge_target, cleanup_worktree_on_approve, delete_branch_after_merge. Useful when the user asks 'is auto-merge on?' or 'where do my runs end up?'.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "start_orchestrator",
    description:
      "Switch the orchestrator into 'running' mode so it auto-picks runnable subtasks every tick. WRITE TOOL: only call with confirmed:true AFTER the user has explicitly approved in plain language. The first call should normally omit confirmed so the user sees the proposed action and confirms.",
    inputSchema: {
      type: "object",
      properties: {
        ...CONFIRMED_PROPERTY,
        max_agents: { type: "integer", description: "Optional: cap on parallel runs. Defaults to the project config." },
      },
      required: [],
    },
  },
  {
    name: "pause_orchestrator",
    description:
      "Pause the orchestrator (active runs continue, no new runs are dispatched). WRITE TOOL: only call with confirmed:true AFTER explicit user approval.",
    inputSchema: { type: "object", properties: { ...CONFIRMED_PROPERTY }, required: [] },
  },
  {
    name: "stop_orchestrator",
    description:
      "Stop the orchestrator and wait for all in-flight runs to finish. WRITE TOOL: only call with confirmed:true AFTER explicit user approval.",
    inputSchema: { type: "object", properties: { ...CONFIRMED_PROPERTY }, required: [] },
  },
  {
    name: "start_subtask",
    description:
      "Launch one specific subtask now (independent of the orchestrator's running mode). Pass either subtask_id or task_id. WRITE TOOL — starts a billable agent run. Only call with confirmed:true AFTER explicit user approval naming the subtask.",
    inputSchema: {
      type: "object",
      properties: {
        ...CONFIRMED_PROPERTY,
        subtask_id: { type: "string", description: "Specific subtask, e.g. subtask_001." },
        task_id: { type: "string", description: "Parent task id, e.g. task_001. Scheduler picks one of its ready subtasks." },
        agent_id: { type: "string", description: "Optional: force a specific agent. Defaults to the scheduler's pick." },
      },
      required: [],
    },
  },
];

export function orchestratorToolNames(): string[] {
  return ORCHESTRATOR_TOOLS.map((tool) => tool.name);
}

export function isWriteTool(name: string): boolean {
  return WRITE_TOOLS.has(name);
}

export interface OrchestratorToolCall {
  backlogDir: string;
  name: string;
  input: unknown;
}

export interface OrchestratorToolOutcome {
  /** False for a refusal or an error; the caller marks the tool result accordingly. */
  ok: boolean;
  result: unknown;
}

// ------------------------------------------------------------------ views --

function runRow(run: Run): Record<string, unknown> {
  return {
    id: run.id,
    target_type: runTargetType(run),
    target_id: runTargetId(run),
    subtask_id: runSubTaskId(run),
    task_id: run.task_id,
    status: run.status,
    agent_id: run.agent_id,
    provider: run.provider,
    repo: run.repo,
    branch: run.branch,
    started_at: run.started_at,
    finished_at: run.finished_at,
    result: run.result,
    worktree_path: run.worktree_path,
  };
}

function subtaskRow(subtask: SubTask): Record<string, unknown> {
  return {
    id: subtask.id,
    title: subtask.title,
    status: subtask.status,
    repo: subtask.repo,
    risk: subtask.risk,
    priority_score: subtask.priority_score,
    depends_on: subtask.depends_on,
    blockers: subtask.blockers,
    scopes: subtask.scopes,
  };
}

function taskRow(item: Task, subtasks: SubTask[]): Record<string, unknown> {
  return {
    id: item.id,
    title: item.title,
    status: item.status,
    priority: item.priority,
    repo_targets: item.repo_targets,
    labels: item.labels,
    subtasks: subtasks.filter((subtask) => subtask.task_id === item.id).map(subtaskRow),
  };
}

// ------------------------------------------------------------------ reads --

function readTool(backlogDir: string, name: string, args: Record<string, unknown>): unknown {
  switch (name) {
    case "list_runs": {
      const runs = listActiveRuns(backlogDir).map(runRow);
      return { count: runs.length, runs };
    }
    case "get_run_events": {
      const runId = String(args["run_id"] ?? "");
      if (!runId) throw new Error("run_id is required");
      const run = loadRun(backlogDir, runId);
      if (!run) throw new Error(`Unknown run: ${runId}`);
      const requested = Number(args["tail"] ?? 30);
      const tail = Math.min(200, Math.max(1, Number.isFinite(requested) ? requested : 30));
      // Parsed for the model, so it gets structured data instead of strings to lex.
      const events = getRunEvents(backlogDir, runId)
        .slice(-tail)
        .map((line) => {
          try {
            return JSON.parse(line) as unknown;
          } catch {
            return { raw: line };
          }
        });
      return { run_id: runId, status: run.status, events };
    }
    case "list_tasks": {
      const filter = String(args["status"] ?? "all");
      const items = listTasks(backlogDir);
      const subtasks = listSubTasks(backlogDir);
      const filtered = filter === "all" ? items : items.filter((item) => item.status === filter);
      return { count: filtered.length, tasks: filtered.map((item) => taskRow(item, subtasks)) };
    }
    case "get_orchestrator_state": {
      const state: OrchestratorState = getOrchestratorState(backlogDir);
      return state;
    }
    case "get_git_settings": {
      const config = loadConfig(backlogDir);
      return {
        branch_strategy: config.git.branch_strategy,
        merge_strategy: config.git.merge_strategy,
        merge_target: config.git.merge_target ?? "(per-repo default_branch)",
        cleanup_worktree_on_approve: config.git.cleanup_worktree_on_approve,
        delete_branch_after_merge: config.git.delete_branch_after_merge,
      };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ----------------------------------------------------------------- writes --

async function writeTool(backlogDir: string, name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "start_orchestrator": {
      const max = typeof args["max_agents"] === "number" ? args["max_agents"] : undefined;
      const state = await startOrchestrator(backlogDir, max ? { max_agents: max } : {});
      return { action: "start_orchestrator", state };
    }
    case "pause_orchestrator":
      return { action: "pause_orchestrator", state: pauseOrchestrator(backlogDir) };
    case "stop_orchestrator":
      return { action: "stop_orchestrator", state: await stopOrchestrator(backlogDir) };
    case "start_subtask": {
      const subtaskId = typeof args["subtask_id"] === "string" ? args["subtask_id"] : undefined;
      const taskId = typeof args["task_id"] === "string" ? args["task_id"] : undefined;
      const forcedAgent = typeof args["agent_id"] === "string" ? args["agent_id"] : undefined;
      if (!subtaskId && !taskId) {
        throw new Error("Pass either subtask_id or task_id");
      }
      const config = loadConfig(backlogDir);
      const plan = buildExecutionPlan(backlogDir, config, {
        ...(taskId ? { workItemId: taskId } : {}),
        ...(subtaskId ? { taskId: subtaskId } : {}),
      });
      const result = await startRunsForPlan({
        backlogDir,
        config,
        plan,
        maxStart: 1,
        ...(forcedAgent ? { forcedAgentId: forcedAgent } : {}),
      });
      const describe = (decision: { targetType: string; taskId: string; reasons: string[] }) => ({
        target_type: decision.targetType,
        target_id: decision.taskId,
        subtask_id: decision.targetType === "subtask" ? decision.taskId : null,
        reasons: decision.reasons,
      });
      return {
        action: "start_subtask",
        started: result.started,
        skipped: result.skipped,
        waiting: plan.waiting.map(describe),
        blocked: plan.blocked.map(describe),
      };
    }
    default:
      throw new Error(`Unknown write tool: ${name}`);
  }
}

/**
 * The confirmation gate. A write tool called without `confirmed: true` gets a
 * refusal describing what it would have done, so the model has to surface the
 * action to the user and be told yes before anything happens. It is the safety
 * net, not the intended path — the system prompt asks for the two-step dance
 * up front.
 */
function awaitingConfirmation(action: string): OrchestratorToolOutcome {
  return {
    ok: false,
    result: {
      status: "awaiting_confirmation",
      message: `Describe what '${action}' would do, who it affects, and ask the user explicitly. Only call this tool again with confirmed:true after the user says yes/oui/go/approve in plain language.`,
    },
  };
}

/** Run one tool. Never throws: failures come back as `ok: false` with a message. */
export async function callOrchestratorTool(call: OrchestratorToolCall): Promise<OrchestratorToolOutcome> {
  const args = (call.input ?? {}) as Record<string, unknown>;
  try {
    if (!isWriteTool(call.name)) {
      return { ok: true, result: readTool(call.backlogDir, call.name, args) };
    }
    if (args["confirmed"] !== true) {
      return awaitingConfirmation(call.name);
    }
    return { ok: true, result: await writeTool(call.backlogDir, call.name, args) };
  } catch (error) {
    return { ok: false, result: { error: error instanceof Error ? error.message : String(error) } };
  }
}
