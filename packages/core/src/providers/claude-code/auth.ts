import type { AgentAuthMode } from "@backlog/schemas";

// Claude Code authenticates itself: a `claude` binary that has been through
// `claude login` carries an OAuth session tied to the user's plan. An
// ANTHROPIC_API_KEY in the environment overrides that session and bills
// per token instead. So the key is a *choice*, not a prerequisite — and in
// subscription mode we must actively unset it, because the executor merges
// `process.env` into the child environment.

export const ANTHROPIC_API_KEY = "ANTHROPIC_API_KEY";

export type ResolvedAuthMode = "subscription" | "api_key";

export interface ClaudeCodeAuthInput {
  authMode?: AgentAuthMode | undefined;
  /** From the project/account secrets store. */
  storedApiKey?: string | null | undefined;
  /** From the shell that launched the server. Wins over the store, matching the historical precedence. */
  inheritedApiKey?: string | null | undefined;
}

export interface ClaudeCodeAuth {
  mode: ResolvedAuthMode;
  /** Overlay merged last into the child environment. An explicit `undefined` unsets the variable. */
  env: Record<string, string | undefined>;
  /** Set when the configured mode cannot be satisfied; surfaced as an agent readiness reason. */
  missingReason?: string;
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return null;
}

export function resolveClaudeCodeAuth(input: ClaudeCodeAuthInput): ClaudeCodeAuth {
  const mode = input.authMode ?? "auto";
  const key = firstNonEmpty(input.inheritedApiKey, input.storedApiKey);

  if (mode === "subscription") {
    return { mode: "subscription", env: { [ANTHROPIC_API_KEY]: undefined } };
  }

  if (mode === "api_key") {
    if (!key) {
      return {
        mode: "api_key",
        env: {},
        missingReason: `missing_api_key:${ANTHROPIC_API_KEY}`,
      };
    }
    return { mode: "api_key", env: { [ANTHROPIC_API_KEY]: key } };
  }

  // auto: use a key when one is around, otherwise let the CLI's own session
  // do the work. Never a blocker either way.
  return key
    ? { mode: "api_key", env: { [ANTHROPIC_API_KEY]: key } }
    : { mode: "subscription", env: { [ANTHROPIC_API_KEY]: undefined } };
}
