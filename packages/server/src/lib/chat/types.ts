// Shared shapes between the two chat backends. Both speak the same event
// vocabulary so the SSE route and the drawer never learn which one answered.

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatStreamEvent {
  type: "text" | "tool_use" | "tool_result" | "done" | "error";
  data: Record<string, unknown>;
}

export interface RunChatInput {
  backlogDir: string;
  /** Working directory for a backend that spawns a process. */
  cwd: string;
  /** The static instructions; project context is appended by the caller. */
  systemPrompt: string;
  /** The user's current turn. */
  prompt: string;
  model?: string | undefined;
  onEvent: (event: ChatStreamEvent) => Promise<void> | void;
  abortSignal?: AbortSignal | undefined;
}

export class ChatUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatUnavailableError";
  }
}
