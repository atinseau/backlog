import Anthropic from "@anthropic-ai/sdk";
import { ORCHESTRATOR_TOOLS, callOrchestratorTool, isWriteTool } from "@backlog/core";
import { loadConfig } from "@backlog/config";
import type { ChatMessage, ChatStreamEvent, RunChatInput } from "./types.js";

/** The shared tool set, in the shape the Anthropic API expects. */
const TOOLS: Anthropic.Tool[] = ORCHESTRATOR_TOOLS.map((tool) => ({
  name: tool.name,
  description: tool.description,
  input_schema: tool.inputSchema as Anthropic.Tool["input_schema"],
}));

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

export const CHAT_SYSTEM_PROMPT = SYSTEM_PROMPT;

export interface AnthropicChatInput extends RunChatInput {
  apiKey: string;
  /** Full conversation, oldest first. The API is stateless, so every turn is resent. */
  messages: ChatMessage[];
}

export async function runAnthropicChat(input: AnthropicChatInput): Promise<void> {
  const { backlogDir, messages, onEvent, abortSignal } = input;
  const model = input.model ?? process.env.BACKLOG_AI_CHAT_MODEL ?? "claude-sonnet-4-6";
  const client = new Anthropic({ apiKey: input.apiKey });

  // Project context lives in the system prompt as a separate block so the
  // static instructions stay frozen across turns. The repo list moves slowly
  // enough that hitting cache on it is fine; live state (runs, tasks) is
  // exposed via tools instead of stuffed into the prefix — that way we
  // don't invalidate the cache on every tick.
  const config = loadConfig(backlogDir);
  const repoSummary = config.repos
    .filter((r) => r.enabled !== false)
    .map((r) => `- ${r.id} (${r.path})`)
    .join("\n");
  const projectContext = `## Project
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
        { type: "text", text: projectContext },
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
      const isWrite = isWriteTool(block.name);
      await onEvent({
        type: "tool_use",
        data: { id: block.id, name: block.name, input: block.input, write: isWrite },
      });

      // callOrchestratorTool never throws: a refusal or an error comes back as
      // ok:false, which the model reads and can act on.
      const outcome = await callOrchestratorTool({ backlogDir, name: block.name, input: block.input });
      const json = JSON.stringify(outcome.result);
      const resultBlock: Anthropic.ToolResultBlockParam = {
        type: "tool_result",
        tool_use_id: block.id,
        content: json,
      };
      if (!outcome.ok) resultBlock.is_error = true;
      toolResults.push(resultBlock);
      await onEvent({
        type: "tool_result",
        data: { id: block.id, name: block.name, size: json.length, awaiting_confirmation: !outcome.ok },
      });
    }
    apiMessages.push({ role: "user", content: toolResults });
  }

  // Should be unreachable — bail out loudly if a model misbehaves.
  await onEvent({
    type: "error",
    data: { message: "Chat exceeded 10 tool-loop iterations; bailing out." },
  });
}
