import Anthropic from "@anthropic-ai/sdk";
import type { Run, SubTask, Task, OrchestratorState } from "@backlog/schemas";
import {
  getOrchestratorState,
  getRunEvents,
  listActiveRuns,
  listSubTasks,
  listTasks,
  loadRun,
} from "@backlog/core";
import { getSecret, loadConfig } from "@backlog/config";

// Read-only by design in V1: the agent can inspect state but not mutate it.
// When we promote write tools (start/pause/stop), they go in a second phase
// behind a confirmation event.
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
        run_id: { type: "string", description: "Run id, e.g. RUN-abc123" },
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
];

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
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

const SYSTEM_PROMPT = `You are the Backlog orchestrator co-pilot. The user is watching a kanban board where autonomous coding agents (Claude, Codex) pick up subtasks and run them in isolated git worktrees. Your job is to help the user understand what's running, why it's stuck, what's queued, and to explain agent activity in real time.

## Tools
You have read-only inspection tools (list_runs, get_run_events, list_tasks, get_orchestrator_state). Use them whenever the user asks a concrete question — never make up run ids, subtask titles, or statuses. Prefer one or two well-targeted tool calls over a broad sweep; the user is watching latency.

## Style
- Match the user's language (French → French, English → English).
- Be concise. The drawer is narrow — short paragraphs, no headings unless the answer is genuinely multi-section.
- When you cite a run or subtask, use its id verbatim (RUN-…, TASK-…).
- If a tool errors, say so plainly and propose what would have worked.
- For "what is X doing right now?" questions, get_run_events with a small tail (10–20) is usually enough.

## Out of scope (V1)
You cannot start, pause, stop, or modify anything yet. If the user asks for an action, explain what command they'd use (▶ on the card, the orchestrator panel toolbar, or \`backlog\` CLI) and offer to inspect the relevant state.`;

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
      await onEvent({
        type: "tool_use",
        data: { id: block.id, name: block.name, input: block.input },
      });
      try {
        const result = runTool({ backlogDir, toolName: block.name, toolInput: block.input });
        const json = JSON.stringify(result);
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: json,
        });
        await onEvent({
          type: "tool_result",
          data: { id: block.id, name: block.name, size: json.length },
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
