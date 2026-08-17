import { executableExists } from "@backlog/core";
import { getSecret, loadConfig } from "@backlog/config";
import { CHAT_SYSTEM_PROMPT, runAnthropicChat, type AnthropicChatInput } from "./anthropic-chat.js";
import { selectChatBackend, type ChatBackend, type ChatBackendInput } from "./backend.js";
import { runClaudeCodeChat, type ClaudeCodeChatInput } from "./claude-code-chat.js";
import type { ChatMessage, ChatStreamEvent } from "./types.js";

export { ChatUnavailableError } from "./types.js";
export type { ChatMessage, ChatStreamEvent } from "./types.js";
export { selectChatBackend, type ChatBackend } from "./backend.js";

/** Seams for tests; production callers let these default to the real engines. */
export interface ChatBackends {
  claudeCode: (input: ClaudeCodeChatInput) => Promise<void>;
  anthropicApi: (input: AnthropicChatInput) => Promise<void>;
  select: (input: ChatBackendInput) => ChatBackend;
}

const REAL_BACKENDS: ChatBackends = {
  claudeCode: runClaudeCodeChat,
  anthropicApi: runAnthropicChat,
  select: selectChatBackend,
};

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
  backends?: ChatBackends | undefined;
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
  const backends = input.backends ?? REAL_BACKENDS;
  const backend = backends.select({
    getSecret: (key) => getSecret(input.backlogDir, key),
    claudeInstalled: executableExists("claude"),
  });
  const systemPrompt = `${CHAT_SYSTEM_PROMPT}\n\n${projectContext(input.backlogDir)}`;
  // Only ever the newest turn. The API is stateless and gets the transcript;
  // the CLI keeps the conversation itself, so replaying it would re-bill the
  // whole history every turn — the very thing --resume exists to avoid.
  const prompt = input.messages.at(-1)?.content ?? "";

  if (backend.kind === "anthropic-api") {
    await backends.anthropicApi({
      backlogDir: input.backlogDir,
      cwd: input.projectRoot,
      systemPrompt,
      prompt,
      messages: input.messages,
      apiKey: backend.apiKey,
      ...(input.model ? { model: input.model } : {}),
      onEvent: input.onEvent,
      ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
    });
    return;
  }

  await backends.claudeCode({
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
