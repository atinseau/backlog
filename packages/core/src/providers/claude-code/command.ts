import type { SandboxMode } from "@backlog/schemas";

// Pure construction of the `claude` invocation. Kept free of I/O so the flag
// matrix is unit-testable without spawning anything.

export type ClaudeCodeOutputFormat = "stream-json" | "json";

export interface ClaudeCodeCommandInput {
  executable: string;
  prompt: string;
  /** Free-form: any alias or dated id the CLI accepts. Never validated here. */
  model?: string | undefined;
  /** Free-form: forwarded verbatim so new effort levels need no code change. */
  reasoningEffort?: string | undefined;
  profile?: string | undefined;
  sandboxMode?: SandboxMode | undefined;
  /** `stream-json` (default) drives the live activity banner; `json` is for one-shot completions. */
  outputFormat?: ClaudeCodeOutputFormat | undefined;
  /** Added on top of Claude Code's own instructions — for a coding run. */
  appendSystemPrompt?: string | undefined;
  /** Replaces them entirely — for a one-shot completion that needs no agent framing. */
  systemPrompt?: string | undefined;
  /** Tool names the session may not use. Empty means no restriction. */
  disallowedTools?: readonly string[] | undefined;
  /** JSON Schema the answer must satisfy. The CLI enforces it and returns the parsed object. */
  jsonSchema?: Record<string, unknown> | undefined;
  /** MCP servers to expose, as the `--mcp-config` payload expects. */
  mcpServers?: Record<string, unknown> | undefined;
  /**
   * Whether to hide the user's own MCP servers behind ours. Default true, which
   * is what the chat wants: it drives the orchestrator and has no business
   * reaching a user's servers. A coding run passes false — those servers are
   * capability the user configured, and removing them silently is a regression.
   */
  strictMcpConfig?: boolean | undefined;
  /** Tool names the session may use. Needed to allow MCP tools in -p mode. */
  allowedTools?: readonly string[] | undefined;
  /** Continue an earlier conversation instead of starting one. */
  resumeSessionId?: string | undefined;
}

export interface ProviderCommand {
  executable: string;
  args: string[];
  /** Written to the child's stdin, then closed. */
  stdin: string;
}

// Repository access policy is enforced upstream by coercing the agent's
// sandbox mode; here we translate it into the only lever the Claude Code
// CLI exposes. `plan` is the read-only contract: the agent can inspect and
// reason but cannot write. Anything else keeps the historical behaviour.
function permissionModeFor(sandboxMode: SandboxMode | undefined): string {
  return sandboxMode === "read-only" ? "plan" : "bypassPermissions";
}

function isBlank(value: string | undefined): value is undefined {
  return value === undefined || value.trim().length === 0;
}

export function buildClaudeCodeCommand(input: ClaudeCodeCommandInput): ProviderCommand {
  const outputFormat = input.outputFormat ?? "stream-json";
  const args = ["-p", "--output-format", outputFormat];

  // `--verbose` is what makes the CLI emit one NDJSON line per agent-loop
  // event; it is meaningless (and noisy) for a single JSON payload.
  if (outputFormat === "stream-json") {
    args.push("--verbose");
  }

  args.push("--permission-mode", permissionModeFor(input.sandboxMode));

  if (!isBlank(input.model)) {
    args.push("--model", input.model.trim());
  }
  if (!isBlank(input.reasoningEffort)) {
    args.push("--effort", input.reasoningEffort.trim());
  }
  if (!isBlank(input.systemPrompt)) {
    args.push("--system-prompt", input.systemPrompt);
  } else if (!isBlank(input.appendSystemPrompt)) {
    args.push("--append-system-prompt", input.appendSystemPrompt);
  }
  if (input.jsonSchema) {
    args.push("--json-schema", JSON.stringify(input.jsonSchema));
  }
  if (input.mcpServers) {
    args.push("--mcp-config", JSON.stringify({ mcpServers: input.mcpServers }));
    // `--strict-mcp-config` keeps the user's own MCP servers — global, and the
    // worktree's project-scoped `.mcp.json` — out of a Backlog session: what we
    // declare is exactly what the model gets. It is on by default here, and
    // waived only by a coding run, which passes strictMcpConfig: false.
    if (input.strictMcpConfig !== false) {
      args.push("--strict-mcp-config");
    }
  }
  // Both tool flags are variadic (`<tools...>`), so each takes a single
  // comma-separated value. Passing names as separate argv entries would make
  // the flag swallow everything after it.
  if (input.allowedTools && input.allowedTools.length > 0) {
    args.push("--allowedTools", input.allowedTools.join(","));
  }
  if (input.disallowedTools && input.disallowedTools.length > 0) {
    args.push("--disallowedTools", input.disallowedTools.join(","));
  }
  if (!isBlank(input.resumeSessionId)) {
    args.push("--resume", input.resumeSessionId.trim());
  }
  if (!isBlank(input.profile)) {
    args.push("--settings", JSON.stringify({ env: { CLAUDE_CODE_PROFILE: input.profile.trim() } }));
  }

  // The prompt goes on stdin, never in argv: the variadic tool flags would eat
  // it, and argv is world-readable through `ps`.
  return { executable: input.executable, args, stdin: input.prompt };
}
