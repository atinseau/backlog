import type { Agent } from "@backlog/schemas";
import { parseClaudeJsonStdout, type UsageBlock } from "../../provider-usage.js";
import { parseJsonObject } from "../json.js";
import { describeProcessFailure, resolveExecutable, spawnStreaming } from "../process.js";
import type {
  AgentProvider,
  ProviderCompletionRequest,
  ProviderCompletionResult,
  ProviderDescriptor,
  ProviderReadiness,
  ProviderReadinessInput,
  ProviderRunRequest,
  ProviderRunResult,
  ProviderStructuredRequest,
  ProviderStructuredResult,
} from "../types.js";
import { ANTHROPIC_API_KEY, resolveClaudeCodeAuth } from "./auth.js";
import { CLAUDE_CODE_MODELS, CLAUDE_CODE_REASONING } from "./catalogue.js";
import { buildClaudeCodeCommand } from "./command.js";
import { isClaudeCodeResultLine, parseClaudeCodeStreamLine } from "./stream.js";

export const CLAUDE_CODE_PROVIDER_ID = "claude-code";
export const DEFAULT_CLAUDE_EXECUTABLE = "claude";

// A one-shot completion is a question, not a mission: no file access, no
// shell, no web. Keeps these calls fast, cheap and side-effect free.
const COMPLETION_DISALLOWED_TOOLS = [
  "Bash",
  "Read",
  "Write",
  "Edit",
  "Glob",
  "Grep",
  "Task",
  "WebFetch",
  "WebSearch",
  "TodoWrite",
] as const;

function structuredSystemPrompt(request: ProviderStructuredRequest): string {
  return [
    request.systemPrompt?.trim(),
    `Reply with a single JSON object named '${request.schemaName}' that validates against this JSON Schema:`,
    JSON.stringify(request.schema),
    "Output the JSON object and nothing else — no prose, no code fences, no explanation.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export interface ClaudeCodeProviderDeps {
  /** Injected so readiness can be unit-tested without touching the filesystem. */
  executableExists: (command: string) => boolean;
}

export function claudeExecutableFor(agent: Pick<Agent, "command">): string {
  const command = agent.command?.trim();
  return command && command.length > 0 ? command : DEFAULT_CLAUDE_EXECUTABLE;
}

/**
 * Claude Code as a Backlog runtime. It is a locally installed CLI that
 * carries its own authenticated session, so unlike a raw API client it needs
 * no credentials from us — an API key is an override, not a prerequisite.
 */
export class ClaudeCodeProvider implements AgentProvider {
  readonly id = CLAUDE_CODE_PROVIDER_ID;
  readonly aliases = ["claude", "anthropic"] as const;

  constructor(private readonly deps: ClaudeCodeProviderDeps) {}

  describe(): ProviderDescriptor {
    return {
      id: this.id,
      displayName: "Claude Code",
      models: CLAUDE_CODE_MODELS,
      reasoning: CLAUDE_CODE_REASONING,
      authModes: ["auto", "subscription", "api_key"],
      sandboxModes: ["read-only", "workspace-write", "danger-full-access"],
      capabilities: { executeRun: true, textCompletion: true, structuredOutput: true },
      requiresCommand: false,
    };
  }

  checkReadiness(input: ProviderReadinessInput): ProviderReadiness {
    const reasons: string[] = [];

    const executable = claudeExecutableFor(input.agent);
    if (!this.deps.executableExists(executable)) {
      reasons.push(`missing_executable:${executable}`);
    }

    const auth = resolveClaudeCodeAuth({
      authMode: input.agent.auth_mode,
      storedApiKey: input.getSecret(ANTHROPIC_API_KEY),
      inheritedApiKey: process.env[ANTHROPIC_API_KEY],
    });
    if (auth.missingReason) {
      reasons.push(auth.missingReason);
    }

    return { ready: reasons.length === 0, reasons };
  }

  async executeRun(request: ProviderRunRequest): Promise<ProviderRunResult> {
    const { agent } = request;
    const command = buildClaudeCodeCommand({
      executable: resolveExecutable(claudeExecutableFor(agent)),
      prompt: request.prompt,
      model: agent.model,
      reasoningEffort: request.reasoningEffort,
      profile: agent.profile,
      sandboxMode: agent.sandbox_mode,
    });

    // The CLI emits one NDJSON line per agent-loop event. We forward each
    // recognised one as it lands so the board shows tool calls live instead
    // of a silent gap, and keep the last `result` line for usage totals.
    let resultLine: string | null = null;
    const spawned = await spawnStreaming({
      executable: command.executable,
      args: command.args,
      cwd: request.cwd,
      env: this.environmentFor(request),
      onLine: (line) => {
        if (isClaudeCodeResultLine(line)) resultLine = line;
        for (const event of parseClaudeCodeStreamLine(line)) {
          request.onActivity(event);
        }
      },
    });

    const parsed = parseClaudeJsonStdout(resultLine ?? spawned.stdout, agent.model ?? this.id);
    const summary = (parsed.summary ?? spawned.stdout).trim();
    const ok = spawned.exitCode === 0;

    return {
      ok,
      summary: summary.length > 0 ? summary : null,
      usage: parsed.usage,
      stdout: spawned.stdout,
      stderr: spawned.stderr,
      ...(ok ? {} : { failure: describeProcessFailure(spawned) }),
    };
  }

  async complete(request: ProviderCompletionRequest): Promise<ProviderCompletionResult> {
    const { text, model, usage } = await this.runCompletion(request, request.systemPrompt);
    if (text.trim().length === 0) {
      throw new Error("Claude Code returned an empty answer.");
    }
    return { text: text.trim(), model, usage };
  }

  async completeStructured<T>(request: ProviderStructuredRequest): Promise<ProviderStructuredResult<T>> {
    const { text, model, usage } = await this.runCompletion(request, structuredSystemPrompt(request));
    return { value: parseJsonObject(text, "Claude Code") as T, model, usage };
  }

  /**
   * One non-interactive turn with tools switched off. The CLI is a coding
   * agent by default; for a naming or planning question we want it to answer
   * from the prompt alone rather than crawl the checkout.
   */
  private async runCompletion(
    request: ProviderCompletionRequest,
    systemPrompt: string | undefined,
  ): Promise<{ text: string; model: string; usage: UsageBlock | null }> {
    const model = request.model ?? request.agent?.model;
    const command = buildClaudeCodeCommand({
      executable: resolveExecutable(request.command ?? claudeExecutableFor(request.agent ?? {})),
      prompt: request.prompt,
      model,
      outputFormat: "json",
      disallowedTools: COMPLETION_DISALLOWED_TOOLS,
      ...(systemPrompt ? { systemPrompt } : {}),
    });

    const spawned = await spawnStreaming({
      executable: command.executable,
      args: command.args,
      cwd: request.cwd ?? process.cwd(),
      env: this.environmentFor({
        agent: request.agent,
        env: process.env,
        getSecret: request.getSecret,
      }),
    });

    if (spawned.exitCode !== 0) {
      const detail = (spawned.stderr || spawned.stdout).trim().slice(0, 400);
      throw new Error(`Claude Code failed (${describeProcessFailure(spawned)}): ${detail}`);
    }

    const parsed = parseClaudeJsonStdout(spawned.stdout, model ?? this.id);
    return {
      text: parsed.summary ?? spawned.stdout,
      model: parsed.usage?.model ?? model ?? this.id,
      usage: parsed.usage,
    };
  }

  /** Base environment plus the auth overlay, which may deliberately unset a key. */
  private environmentFor(request: {
    agent?: Agent | undefined;
    env: NodeJS.ProcessEnv;
    getSecret: (key: string) => string | null;
  }): NodeJS.ProcessEnv {
    const auth = resolveClaudeCodeAuth({
      authMode: request.agent?.auth_mode,
      storedApiKey: request.getSecret(ANTHROPIC_API_KEY),
      inheritedApiKey: request.env[ANTHROPIC_API_KEY],
    });
    return { ...request.env, ...auth.env };
  }
}
