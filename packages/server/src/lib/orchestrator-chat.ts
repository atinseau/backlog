import Anthropic from "@anthropic-ai/sdk";
import type { Run, SubTask, Task, OrchestratorState } from "@backlog/schemas";
import {
  buildExecutionPlan,
  getOrchestratorState,
  getRunEvents,
  listActiveRuns,
  listSubTasks,
  listTasks,
  loadRun,
  pauseOrchestrator,
  startOrchestrator,
  startRunsForPlan,
  stopOrchestrator,
} from "@backlog/core";
import { getSecret, loadConfig } from "@backlog/config";

// Mutating tools (start_orchestrator, start_subtask, pause, stop) are gated
// by a required `confirmed: true` argument the model has to set explicitly.
// First call (typically without `confirmed`) returns an awaiting_confirmation
// stub; the agent then asks the user, and only re-calls with confirmed:true
// after explicit approval. This keeps the gate visible in the conversation
// and prevents an over-eager model from firing a billable run as a
// side-effect of a casual question.
const WRITE_TOOL_NAMES = new Set([
  "start_orchestrator",
  "pause_orchestrator",
  "stop_orchestrator",
  "start_subtask",
]);
const TOOLS: Anthropic.Tool[] = [
  {
    name: "list_runs",
    description:
      "List active runs (preparing/running/awaiting_review) in the workspace. Returns id, subtask_id, status, agent_id, branch, repo, started_at, last result line.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_run_events",
    description:
      "Return the last N lines of a run's events.ndjson — useful to see what an agent is doing right now. Lines are JSON objects with type/message/ts.",
    input_schema: {
      type: "object",
      properties: {
        run_id: { type: "string", description: "Run id, e.g. run_001" },
        tail: {
          type: "integer",
          description: "Number of lines from the end (default 30, max 200).",
        },
      },
      required: ["run_id"],
    },
  },
  {
    name: "list_tasks",
    description:
      "List parent tasks (work items) and their subtasks with current status. Use this to answer 'what's queued', 'what's running', 'what's blocked'.",
    input_schema: {
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
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "start_orchestrator",
    description:
      "Switch the orchestrator into 'running' mode so it auto-picks runnable subtasks every tick. WRITE TOOL: only call with confirmed:true AFTER the user has explicitly approved in plain language. The first call should normally omit confirmed (or pass false) so the user sees the proposed action and confirms.",
    input_schema: {
      type: "object",
      properties: {
        confirmed: {
          type: "boolean",
          description: "Set to true ONLY after the user has explicitly approved this specific action in plain language.",
        },
        max_agents: {
          type: "integer",
          description: "Optional: cap on parallel runs. Defaults to the workspace config.",
        },
      },
      required: [],
    },
  },
  {
    name: "pause_orchestrator",
    description:
      "Pause the orchestrator (active runs continue, no new runs are dispatched). WRITE TOOL: only call with confirmed:true AFTER explicit user approval.",
    input_schema: {
      type: "object",
      properties: {
        confirmed: { type: "boolean" },
      },
      required: [],
    },
  },
  {
    name: "stop_orchestrator",
    description:
      "Stop the orchestrator and wait for all in-flight runs to finish. WRITE TOOL: only call with confirmed:true AFTER explicit user approval.",
    input_schema: {
      type: "object",
      properties: {
        confirmed: { type: "boolean" },
      },
      required: [],
    },
  },
  {
    name: "get_git_settings",
    description:
      "Read the workspace's git settings: branch_strategy, merge_strategy, merge_target, cleanup_worktree_on_approve, delete_branch_after_merge. Useful when the user asks 'is auto-merge on?' or 'where do my runs end up?'.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "start_subtask",
    description:
      "Launch one specific subtask now (independent of the orchestrator's running mode). Pass either subtask_id or task_id. WRITE TOOL — costs real money on codex/claude agents. Only call with confirmed:true AFTER explicit user approval naming the subtask.",
    input_schema: {
      type: "object",
      properties: {
        confirmed: { type: "boolean" },
        subtask_id: { type: "string", description: "Specific subtask, e.g. subtask_001." },
        task_id: { type: "string", description: "Parent task id, e.g. task_001. Scheduler picks one of its ready subtasks." },
        agent_id: { type: "string", description: "Optional: force a specific agent (claude-default, codex-default, …). Defaults to the scheduler's pick." },
      },
      required: [],
    },
  },
];

interface WriteToolOutcome {
  ok: boolean;
  result: unknown;
}

function awaitingConfirmation(action: string): WriteToolOutcome {
  return {
    ok: false,
    result: {
      status: "awaiting_confirmation",
      message: `Describe what '${action}' would do, who it affects, and ask the user explicitly. Only call this tool again with confirmed:true after the user says yes/oui/go/approve in plain language.`,
    },
  };
}

interface ToolHandlerInput {
  backlogDir: string;
  toolName: string;
  toolInput: unknown;
}

function runRow(run: Run): Record<string, unknown> {
  return {
    id: run.id,
    subtask_id: run.subtask_id,
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

function subtaskRow(t: SubTask): Record<string, unknown> {
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    repo: t.repo,
    risk: t.risk,
    priority_score: t.priority_score,
    depends_on: t.depends_on,
    blockers: t.blockers,
    scopes: t.scopes,
  };
}

function taskRow(item: Task, subs: SubTask[]): Record<string, unknown> {
  return {
    id: item.id,
    title: item.title,
    status: item.status,
    priority: item.priority,
    repo_targets: item.repo_targets,
    labels: item.labels,
    subtasks: subs.filter((s) => s.task_id === item.id).map(subtaskRow),
  };
}

function runTool(input: ToolHandlerInput): unknown {
  const { backlogDir, toolName, toolInput } = input;
  const args = (toolInput ?? {}) as Record<string, unknown>;
  switch (toolName) {
    case "list_runs": {
      const runs = listActiveRuns(backlogDir).map(runRow);
      return { count: runs.length, runs };
    }
    case "get_run_events": {
      const runId = String(args["run_id"] ?? "");
      const tailRaw = Number(args["tail"] ?? 30);
      const tail = Math.min(200, Math.max(1, Number.isFinite(tailRaw) ? tailRaw : 30));
      if (!runId) throw new Error("run_id is required");
      const run = loadRun(backlogDir, runId);
      if (!run) throw new Error(`Unknown run: ${runId}`);
      const events = getRunEvents(backlogDir, runId);
      // events is string[] of NDJSON lines — keep the tail and parse for the
      // model so it gets structured data instead of raw strings to lex.
      const slice = events.slice(-tail);
      const parsed = slice.map((line) => {
        try {
          return JSON.parse(line) as unknown;
        } catch {
          return { raw: line };
        }
      });
      return { run_id: runId, status: run.status, events: parsed };
    }
    case "list_tasks": {
      const filter = String(args["status"] ?? "all");
      const items = listTasks(backlogDir);
      const subs = listSubTasks(backlogDir);
      const filtered = filter === "all" ? items : items.filter((i) => i.status === filter);
      return { count: filtered.length, tasks: filtered.map((i) => taskRow(i, subs)) };
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
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

async function runWriteTool(input: ToolHandlerInput): Promise<WriteToolOutcome> {
  const { backlogDir, toolName, toolInput } = input;
  const args = (toolInput ?? {}) as Record<string, unknown>;
  if (args["confirmed"] !== true) {
    return awaitingConfirmation(toolName);
  }
  switch (toolName) {
    case "start_orchestrator": {
      const max = typeof args["max_agents"] === "number" ? (args["max_agents"] as number) : undefined;
      const state = await startOrchestrator(backlogDir, max ? { max_agents: max } : {});
      return { ok: true, result: { action: "start_orchestrator", state } };
    }
    case "pause_orchestrator": {
      const state = pauseOrchestrator(backlogDir);
      return { ok: true, result: { action: "pause_orchestrator", state } };
    }
    case "stop_orchestrator": {
      const state = await stopOrchestrator(backlogDir);
      return { ok: true, result: { action: "stop_orchestrator", state } };
    }
    case "start_subtask": {
      const subtaskId = typeof args["subtask_id"] === "string" ? (args["subtask_id"] as string) : undefined;
      const taskId = typeof args["task_id"] === "string" ? (args["task_id"] as string) : undefined;
      const forcedAgent = typeof args["agent_id"] === "string" ? (args["agent_id"] as string) : undefined;
      if (!subtaskId && !taskId) {
        throw new Error("Pass either subtask_id or task_id");
      }
      const config = loadConfig(backlogDir);
      const planOpts: { workItemId?: string; taskId?: string } = {};
      if (taskId) planOpts.workItemId = taskId;
      if (subtaskId) planOpts.taskId = subtaskId;
      const plan = buildExecutionPlan(backlogDir, config, planOpts);
      const launcherInput: Parameters<typeof startRunsForPlan>[0] = {
        backlogDir,
        config,
        plan,
        maxStart: 1,
      };
      if (forcedAgent) launcherInput.forcedAgentId = forcedAgent;
      const result = await startRunsForPlan(launcherInput);
      return {
        ok: true,
        result: {
          action: "start_subtask",
          started: result.started,
          skipped: result.skipped,
          waiting: plan.waiting.map((d) => ({ subtask_id: d.taskId, reasons: d.reasons })),
          blocked: plan.blocked.map((d) => ({ subtask_id: d.taskId, reasons: d.reasons })),
        },
      };
    }
    default:
      throw new Error(`Unknown write tool: ${toolName}`);
  }
}

const SYSTEM_PROMPT = `You are the Backlog orchestrator co-pilot. The user is watching a kanban board where autonomous coding agents (Claude, Codex) pick up subtasks and run them in isolated git worktrees. Your job is to help the user understand what's running, why it's stuck, what's queued, to explain agent activity in real time, and — when explicitly asked — to dispatch actions on their behalf.

## Read tools (use freely)
list_runs, get_run_events, list_tasks, get_orchestrator_state. Call these whenever the user asks a concrete question — never make up run ids, subtask titles, or statuses. Prefer one or two well-targeted tool calls over a broad sweep.

## Write tools (gated by explicit user approval)
start_orchestrator, pause_orchestrator, stop_orchestrator, start_subtask. These mutate state and can cost real money (start_subtask launches a billable codex/claude run). The protocol is **always two steps**:

  1. **Propose, don't execute.** Even if the user's message looks like a command ("lance la tâche X", "arrête tout"), your first response is a plain-language description of what you would do, which subtask/run/state it affects, and an explicit ask: "Tu confirmes ?" (or the English equivalent). Do NOT call the write tool yet.
  2. **Wait for confirmation.** Only after the user replies with explicit approval ("oui", "go", "confirme", "yes", "approve") do you call the write tool again with confirmed:true.

If you call a write tool without confirmed:true, the tool returns an awaiting_confirmation stub — that's the safety net, not the intended path. Don't rely on it.

If the user's first message is itself an explicit approval ("oui démarre l'orchestrateur"), you may treat that as the confirmation step and call the tool with confirmed:true directly — but only if the action is unambiguous (no choice of subtask/agent etc). When in doubt, propose and wait.

## Style
- Match the user's language (French → French, English → English).
- Be concise. The drawer is narrow — short paragraphs, no headings unless the answer is genuinely multi-section.
- When you cite a run or subtask, use its id verbatim (run_…, task_…, subtask_…).
- After executing a write tool, summarize what happened in one sentence and stop — don't follow up with a tool call unless the user asks.`;

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatStreamEvent {
  type: "text" | "tool_use" | "tool_result" | "done" | "error";
  data: Record<string, unknown>;
}

export interface ChatCredentials {
  // Exactly one of these must be set. apiKey → x-api-key header (standard
  // ANTHROPIC_API_KEY). authToken → Authorization: Bearer (Claude Code
  // OAuth token, sk-ant-oat01-…).
  apiKey?: string;
  authToken?: string;
}

export interface RunChatInput {
  backlogDir: string;
  messages: ChatMessage[];
  credentials: ChatCredentials;
  model?: string;
  onEvent: (event: ChatStreamEvent) => Promise<void> | void;
  abortSignal?: AbortSignal;
}

export class ChatUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatUnavailableError";
  }
}

export function resolveChatCredentials(backlogDir: string): ChatCredentials | null {
  // Resolution order: env var (matches the splitter), then per-workspace
  // encrypted secrets store (so users can `backlog secrets set
  // ANTHROPIC_API_KEY` without juggling shells). OAuth tokens are
  // intentionally NOT supported as a fallback — the public API rejects
  // CLAUDE_CODE_OAUTH_TOKEN with 401 "OAuth authentication is currently
  // not supported", so accepting it here would only produce confusing
  // errors after the first message.
  const env = process.env.ANTHROPIC_API_KEY;
  if (env) return { apiKey: env };
  const stored = getSecret(backlogDir, "ANTHROPIC_API_KEY");
  if (stored) return { apiKey: stored };
  return null;
}

export async function runOrchestratorChat(input: RunChatInput): Promise<void> {
  const { backlogDir, messages, credentials, onEvent, abortSignal } = input;
  const model = input.model ?? process.env.BACKLOG_AI_CHAT_MODEL ?? "claude-opus-4-7";
  if (!credentials.apiKey && !credentials.authToken) {
    throw new ChatUnavailableError("No Anthropic credentials configured");
  }
  const client = new Anthropic(
    credentials.apiKey ? { apiKey: credentials.apiKey } : { authToken: credentials.authToken },
  );

  // Workspace context lives in the system prompt as a separate block so the
  // static instructions stay frozen across turns. The repo list moves slowly
  // enough that hitting cache on it is fine; live state (runs, tasks) is
  // exposed via tools instead of stuffed into the prefix — that way we
  // don't invalidate the cache on every tick.
  const config = loadConfig(backlogDir);
  const repoSummary = config.repos
    .filter((r) => r.enabled !== false)
    .map((r) => `- ${r.id} (${r.path})`)
    .join("\n");
  const workspaceContext = `## Workspace
project_id: ${config.project_id ?? "(unset)"}
project_name: ${config.project_name ?? "(unset)"}
autonomy_mode: ${config.autonomy_mode}
max_agents: ${config.max_agents}
repos:
${repoSummary || "  (none configured)"}`;

  const apiMessages: Anthropic.MessageParam[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // Manual agentic loop — we own each turn so we can stream text deltas
  // back to the SSE channel and surface tool_use/tool_result events to the
  // UI as they happen (not just at the end).
  let safety = 0;
  while (safety++ < 10) {
    if (abortSignal?.aborted) return;

    const stream = client.messages.stream({
      model,
      max_tokens: 4096,
      thinking: { type: "adaptive" },
      system: [
        { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
        { type: "text", text: workspaceContext },
      ],
      tools: TOOLS,
      messages: apiMessages,
    });

    stream.on("text", (delta) => {
      void onEvent({ type: "text", data: { delta } });
    });

    const finalMessage = await stream.finalMessage();

    // Always append the full assistant turn (tool_use blocks included) so
    // tool_result blocks in the next user turn match by id.
    apiMessages.push({ role: "assistant", content: finalMessage.content });

    if (finalMessage.stop_reason === "end_turn" || finalMessage.stop_reason === "stop_sequence") {
      await onEvent({
        type: "done",
        data: {
          stop_reason: finalMessage.stop_reason,
          usage: finalMessage.usage,
        },
      });
      return;
    }

    if (finalMessage.stop_reason !== "tool_use") {
      // refusal, max_tokens, pause_turn — surface and stop.
      await onEvent({
        type: "done",
        data: { stop_reason: finalMessage.stop_reason, usage: finalMessage.usage },
      });
      return;
    }

    const toolUses = finalMessage.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    if (toolUses.length === 0) return;

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of toolUses) {
      const isWrite = WRITE_TOOL_NAMES.has(block.name);
      await onEvent({
        type: "tool_use",
        data: { id: block.id, name: block.name, input: block.input, write: isWrite },
      });
      try {
        let json: string;
        let isError = false;
        if (isWrite) {
          const outcome = await runWriteTool({
            backlogDir,
            toolName: block.name,
            toolInput: block.input,
          });
          json = JSON.stringify(outcome.result);
          isError = !outcome.ok;
        } else {
          const result = runTool({ backlogDir, toolName: block.name, toolInput: block.input });
          json = JSON.stringify(result);
        }
        const resultBlock: Anthropic.ToolResultBlockParam = {
          type: "tool_result",
          tool_use_id: block.id,
          content: json,
        };
        if (isError) resultBlock.is_error = true;
        toolResults.push(resultBlock);
        await onEvent({
          type: "tool_result",
          data: { id: block.id, name: block.name, size: json.length, awaiting_confirmation: isError },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: message,
          is_error: true,
        });
        await onEvent({
          type: "tool_result",
          data: { id: block.id, name: block.name, error: message },
        });
      }
    }
    apiMessages.push({ role: "user", content: toolResults });
  }

  // Should be unreachable — bail out loudly if a model misbehaves.
  await onEvent({
    type: "error",
    data: { message: "Chat exceeded 10 tool-loop iterations; bailing out." },
  });
}
