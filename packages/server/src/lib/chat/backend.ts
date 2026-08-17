import { ANTHROPIC_API_KEY } from "@backlog/core";
import { ChatUnavailableError } from "./types.js";

export { ChatUnavailableError };

// Two engines can answer the chat, and they are not interchangeable in cost or
// speed. The API talks to the model directly and runs its tool loop natively;
// the CLI spawns a full Claude Code session that reaches Backlog through MCP,
// which is slower and burns more context — but needs no key, so it is what
// makes the feature work on a subscription.

export type ChatBackend =
  | { kind: "anthropic-api"; apiKey: string }
  | { kind: "claude-code" };

export interface ChatBackendInput {
  getSecret: (key: string) => string | null;
  claudeInstalled: boolean;
  /** Force one engine. Ignored when the environment cannot provide it. */
  prefer?: ChatBackend["kind"] | undefined;
}

export function selectChatBackend(input: ChatBackendInput): ChatBackend {
  // The shell wins over the store, matching how every other credential is read.
  const apiKey = process.env[ANTHROPIC_API_KEY] ?? input.getSecret(ANTHROPIC_API_KEY);

  if (input.prefer === "claude-code" && input.claudeInstalled) {
    return { kind: "claude-code" };
  }
  if (apiKey) {
    return { kind: "anthropic-api", apiKey };
  }
  if (input.claudeInstalled) {
    return { kind: "claude-code" };
  }

  throw new ChatUnavailableError(
    `The orchestrator chat needs either an ${ANTHROPIC_API_KEY} (store it with \`backlog secrets set ${ANTHROPIC_API_KEY}\`) ` +
      "or the `claude` CLI installed and logged in, which works on a Claude subscription with no key at all.",
  );
}
