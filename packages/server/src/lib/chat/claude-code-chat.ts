import {
  buildClaudeCodeCommand,
  isWriteTool,
  orchestratorToolNames,
  resolveExecutable,
  selfExec,
  spawnStreaming,
  type ProviderCommand,
} from "@backlog/core";
import type { ChatStreamEvent, RunChatInput } from "./types.js";

// The orchestrator chat, driven by the locally installed Claude Code CLI
// instead of the HTTP API. The tools it needs are served by Backlog's own MCP
// server (`backlog mcp-server`), which the CLI spawns; that is what lets this
// feature run on a subscription with no API key anywhere.

const MCP_SERVER_NAME = "backlog";
const MCP_TOOL_PREFIX = `mcp__${MCP_SERVER_NAME}__`;

// The chat drives the orchestrator; it has no business reading or writing the
// checkout. Two facts learned from the CLI shape this list:
//   * plan mode refuses MCP calls, so it cannot be the guard rail;
//   * `--allowedTools` only auto-approves, it does not exclude — left alone,
//     the model reaches for Bash the moment MCP is unhandy.
// So: permissions bypassed for the MCP tools, everything built in denied.
const DENIED_BUILT_IN_TOOLS = [
  "Bash",
  "BashOutput",
  "KillBash",
  "Read",
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
  "Glob",
  "Grep",
  "Task",
  "WebFetch",
  "WebSearch",
  "TodoWrite",
  "ExitPlanMode",
  "ToolSearch",
  "SlashCommand",
  "Skill",
] as const;

export interface ChatCommandInput {
  executable: string;
  /** Project whose orchestrator the tools act on. */
  backlogDir: string;
  /** How to re-invoke this binary — see selfExec(); a dev run needs prefix args. */
  selfCommand: string;
  selfPrefixArgs: string[];
  systemPrompt: string;
  prompt: string;
  model?: string | undefined;
  resumeSessionId?: string | undefined;
}

/** MCP tools are namespaced by their server; the CLI needs the full name to allow them. */
function namespacedToolNames(): string[] {
  return orchestratorToolNames().map((name) => `${MCP_TOOL_PREFIX}${name}`);
}

export function buildChatCommand(input: ChatCommandInput): ProviderCommand {
  const command = buildClaudeCodeCommand({
    executable: input.executable,
    prompt: input.prompt,
    model: input.model,
    outputFormat: "stream-json",
    appendSystemPrompt: input.systemPrompt,
    allowedTools: namespacedToolNames(),
    disallowedTools: DENIED_BUILT_IN_TOOLS,
    mcpServers: {
      [MCP_SERVER_NAME]: {
        command: input.selfCommand,
        // Explicit: `mcp-server` defaults to the agent tool set, which has no
        // orchestration tools. The chat is the one caller that needs them.
        args: [...input.selfPrefixArgs, "mcp-server", "--audience", "orchestrator", "--project", input.backlogDir],
      },
    },
    ...(input.resumeSessionId ? { resumeSessionId: input.resumeSessionId } : {}),
  });
  command.args.push("--include-partial-messages");
  return command;
}

function bareToolName(name: string): string {
  return name.startsWith(MCP_TOOL_PREFIX) ? name.slice(MCP_TOOL_PREFIX.length) : name;
}

function parse(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function textDelta(payload: Record<string, unknown>): ChatStreamEvent[] {
  const event = payload["event"] as { type?: string; delta?: { type?: string; text?: string } } | undefined;
  if (event?.type !== "content_block_delta" || event.delta?.type !== "text_delta") return [];
  return [{ type: "text", data: { delta: event.delta.text ?? "" } }];
}

function toolUses(payload: Record<string, unknown>): ChatStreamEvent[] {
  const message = payload["message"] as { content?: Array<Record<string, unknown>> } | undefined;
  return (message?.content ?? [])
    .filter((block) => block["type"] === "tool_use")
    .map((block) => {
      const name = bareToolName(String(block["name"] ?? ""));
      return {
        type: "tool_use" as const,
        data: { id: String(block["id"] ?? ""), name, input: block["input"] ?? {}, write: isWriteTool(name) },
      };
    });
}

function toolResults(payload: Record<string, unknown>): ChatStreamEvent[] {
  const message = payload["message"] as { content?: Array<Record<string, unknown>> } | undefined;
  return (message?.content ?? [])
    .filter((block) => block["type"] === "tool_result")
    .map((block) => ({
      type: "tool_result" as const,
      // An error result is the confirmation gate refusing: the model is
      // expected to ask the user and call again, not to give up.
      data: { id: String(block["tool_use_id"] ?? ""), awaiting_confirmation: block["is_error"] === true },
    }));
}

/**
 * Translate one line of the CLI's stream into the SSE events the drawer
 * already understands. Assistant text blocks are dropped: the same text
 * already arrived as deltas, and emitting both would duplicate it.
 */
export function parseChatStreamLine(line: string): ChatStreamEvent[] {
  const payload = parse(line);
  if (!payload) return [];

  switch (payload["type"]) {
    case "stream_event":
      return textDelta(payload);
    case "assistant":
      return toolUses(payload);
    case "user":
      return toolResults(payload);
    case "result":
      return [
        {
          type: "done",
          data: {
            session_id: String(payload["session_id"] ?? ""),
            usage: payload["usage"] ?? null,
            stop_reason: payload["is_error"] === true ? "error" : "end_turn",
          },
        },
      ];
    default:
      return [];
  }
}

/**
 * A readable reason for a failed session. The CLI reports its own problems —
 * "Not logged in", "Credit balance is too low" — as an assistant message in
 * the stream, so a raw stdout dump would show the user NDJSON instead of the
 * one sentence that tells them what to do.
 */
export function explainChatFailure(stdout: string, stderr: string): string {
  const fromStderr = stderr.trim();
  if (fromStderr) return fromStderr.slice(0, 400);

  let lastMessage: string | null = null;
  for (const line of stdout.split("\n")) {
    const payload = parse(line);
    if (payload?.["type"] !== "assistant") continue;
    const message = payload["message"] as { content?: Array<Record<string, unknown>> } | undefined;
    for (const block of message?.content ?? []) {
      if (block["type"] === "text" && String(block["text"] ?? "").trim()) {
        lastMessage = String(block["text"]).trim();
      }
    }
  }
  return lastMessage?.slice(0, 400) ?? "Claude Code exited without producing an answer.";
}

export interface ClaudeCodeChatInput extends RunChatInput {
  /** Conversation to continue. Absent on the first turn. */
  resumeSessionId?: string | undefined;
  /** Overridden in tests; defaults to the `claude` on PATH. */
  executable?: string | undefined;
}

export async function runClaudeCodeChat(input: ClaudeCodeChatInput): Promise<void> {
  const { command: selfCommand, prefixArgs } = selfExec();
  const command = buildChatCommand({
    executable: resolveExecutable(input.executable ?? "claude"),
    backlogDir: input.backlogDir,
    selfCommand,
    selfPrefixArgs: prefixArgs,
    systemPrompt: input.systemPrompt,
    prompt: input.prompt,
    ...(input.model ? { model: input.model } : {}),
    ...(input.resumeSessionId ? { resumeSessionId: input.resumeSessionId } : {}),
  });

  const spawned = await spawnStreaming({
    executable: command.executable,
    args: command.args,
    cwd: input.cwd,
    env: process.env,
    input: command.stdin,
    onLine: (line) => {
      for (const event of parseChatStreamLine(line)) {
        void input.onEvent(event);
      }
    },
  });

  if (spawned.exitCode !== 0) {
    await input.onEvent({
      type: "error",
      data: { status: "error", message: explainChatFailure(spawned.stdout, spawned.stderr) },
    });
  }
}
