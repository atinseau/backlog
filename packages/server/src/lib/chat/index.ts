import { executableExists } from "@backlog/core";
import { getSecret, loadConfig } from "@backlog/config";
import { CHAT_SYSTEM_PROMPT, runAnthropicChat } from "./anthropic-chat.js";
import { selectChatBackend, type ChatBackend } from "./backend.js";
import { runClaudeCodeChat } from "./claude-code-chat.js";
import type { ChatMessage, ChatStreamEvent } from "./types.js";

export { ChatUnavailableError } from "./types.js";
export type { ChatMessage, ChatStreamEvent } from "./types.js";
export { selectChatBackend, type ChatBackend } from "./backend.js";

export interface OrchestratorChatInput {
  backlogDir: string;
  /** Project root, used as the working directory of a spawned CLI session. */
  projectRoot: string;
  messages: ChatMessage[];
  /** Conversation to resume, for the CLI backend. Absent on the first turn. */
  sessionId?: string | undefined;
  model?: string | undefined;
  onEvent: (event: ChatStreamEvent) => Promise<void> | void;
  abortSignal?: AbortSignal | undefined;
}

/**
 * Project facts that change slowly. Live state (runs, tasks) is deliberately
 * left to the tools: putting it in the prefix would invalidate the prompt
 * cache on every tick.
 */
function projectContext(backlogDir: string): string {
  const config = loadConfig(backlogDir);
  const repos = config.repos
    .filter((repo) => repo.enabled !== false)
    .map((repo) => `- ${repo.id} (${repo.path})`)
    .join("\n");
  return [
    "## Project",
    `project_id: ${config.project_id ?? "(unset)"}`,
    `project_name: ${config.project_name ?? "(unset)"}`,
    `autonomy_mode: ${config.autonomy_mode}`,
    `max_agents: ${config.max_agents}`,
    "repos:",
    repos || "  (none configured)",
  ].join("\n");
}

export function resolveChatBackend(backlogDir: string): ChatBackend {
  return selectChatBackend({
    getSecret: (key) => getSecret(backlogDir, key),
    claudeInstalled: executableExists("claude"),
  });
}

/**
 * Run one turn of the orchestrator chat on whichever engine is available.
 * Both emit the same events, so the SSE route and the drawer never learn which
 * one answered.
 */
export async function runOrchestratorChat(input: OrchestratorChatInput): Promise<void> {
  const backend = resolveChatBackend(input.backlogDir);
  const systemPrompt = `${CHAT_SYSTEM_PROMPT}\n\n${projectContext(input.backlogDir)}`;

  if (backend.kind === "anthropic-api") {
    await runAnthropicChat({
      backlogDir: input.backlogDir,
      cwd: input.projectRoot,
      systemPrompt,
      prompt: input.messages.at(-1)?.content ?? "",
      messages: input.messages,
      apiKey: backend.apiKey,
      ...(input.model ? { model: input.model } : {}),
      onEvent: input.onEvent,
      ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
    });
    return;
  }

  // The CLI keeps its own conversation, so only the new turn is sent. Without
  // a session to resume — a first turn, or a client that lost the id — the
  // whole history goes in as one prompt so context is not silently dropped.
  const prompt = input.sessionId
    ? (input.messages.at(-1)?.content ?? "")
    : input.messages.map((message) => `${message.role}: ${message.content}`).join("\n\n");

  await runClaudeCodeChat({
    backlogDir: input.backlogDir,
    cwd: input.projectRoot,
    systemPrompt,
    prompt,
    ...(input.model ? { model: input.model } : {}),
    ...(input.sessionId ? { resumeSessionId: input.sessionId } : {}),
    onEvent: input.onEvent,
    ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
  });
}
