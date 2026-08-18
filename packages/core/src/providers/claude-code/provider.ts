import type { Agent } from "@backlog/schemas";
import { writeStopHook } from "@backlog/hooks";
import { contextFor } from "../../contexts/contexts.js";
import { MCP_SERVER_NAME } from "../../mcp/server.js";
import { parseClaudeJsonStdout, type UsageBlock } from "../../provider-usage.js";
import { selfExec } from "../../self-exec.js";
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
import { buildClaudeCodeCommand, type ProviderCommand } from "./command.js";
import { isClaudeCodeResultLine, parseClaudeCodeStreamLine } from "./stream.js";

export const CLAUDE_CODE_PROVIDER_ID = "claude-code";
export const DEFAULT_CLAUDE_EXECUTABLE = "claude";

export interface ClaudeCodeProviderDeps {
  /** Injected so readiness can be unit-tested without touching the filesystem. */
  executableExists: (command: string) => boolean;
}

export function claudeExecutableFor(agent: Pick<Agent, "command">): string {
  const command = agent.command?.trim();
  return command && command.length > 0 ? command : DEFAULT_CLAUDE_EXECUTABLE;
}

/**
 * The run context the MCP server subprocess needs to fill a trace's `run_id`,
 * `task_id` and `subtask_id` without the agent restating them.
 *
 * Declared explicitly, and deliberately redundant: a `claude` CLI probed for
 * this branch does hand a stdio MCP server the parent environment, but that is
 * undocumented third-party behaviour — the reference MCP SDK filters the child
 * environment down to an allowlist, and nothing here would notice the CLI
 * adopting the same policy. Declaring the three keys makes the dependency a
 * contract instead of a coincidence.
 *
 * Absent keys are omitted rather than written as `undefined`, so a task-level
 * run — which has no subtask, see `environmentFor` in run-executor.ts — does not
 * regain a `BACKLOG_SUBTASK_ID` holding a task id through this path.
 */
function mcpServerEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const carried: Record<string, string> = {};
  for (const key of ["BACKLOG_RUN_ID", "BACKLOG_TASK_ID", "BACKLOG_SUBTASK_ID"] as const) {
    const value = env[key];
    if (value !== undefined && value.length > 0) {
      carried[key] = value;
    }
  }
  return carried;
}

/**
 * The environment variable the CLI's role guard reads
 * (`AGENT_ROLE_ENV` in `packages/cli/src/role-guard.ts`). Spelled out here
 * rather than imported: core must not depend on cli, and the guard has to run
 * at the entrypoint before anything else is loaded.
 */
const AGENT_ROLE_ENV = "BACKLOG_AGENT_ROLE";

/**
 * The CLI role every run's agent carries.
 *
 * The role is not a label on a run, it is one half of a trade: the CLI is
 * closed *because* the façade replaces it. Both halves are now unconditional,
 * so they cannot drift apart.
 */
export function executionCliRole(): string | null {
  return contextFor("execution").cliRole;
}

/**
 * The other half of the same trade. Today the single entry `Bash(backlog:*)`,
 * which denies any shell command whose first word is `backlog`.
 */
export function executionDeniedBuiltins(): readonly string[] {
  return contextFor("execution").deniedBuiltins;
}

/**
 * The `claude` invocation for one coding run. Extracted from executeRun so the
 * flag matrix — which tool set the agent gets, and which it does not — is
 * asserted by a unit test rather than by spawning a real CLI.
 */
export function buildRunCommand(request: ProviderRunRequest): ProviderCommand {
  const { agent } = request;
  const self = selfExec();
  // Every permission decision here comes from the table, not from literals in
  // this file — that is the point of contexts/contexts.ts.
  const context = contextFor("execution");
  return buildClaudeCodeCommand({
    executable: resolveExecutable(claudeExecutableFor(agent)),
    prompt: request.prompt,
    model: agent.model,
    reasoningEffort: request.reasoningEffort,
    profile: agent.profile,
    // Written per run rather than at install time: the script is identical for
    // every run — it reads the run's identity from the environment — but a
    // project that predates this feature has no bin/stop-hook, and a run is
    // the moment we know we need one.
    stopHookCommand: writeStopHook(request.backlogDir),
    mcpServers: {
      [MCP_SERVER_NAME]: {
        command: self.command,
        // The audience is what keeps `start_subtask` and friends out of an
        // execution agent's reach. --project is mandatory: the run's cwd is a
        // worktree carrying a shadow .backlog/, so resolution from cwd is wrong.
        args: [
          ...self.prefixArgs,
          "mcp-server",
          "--audience",
          context.mcpAudience!,
          "--project",
          request.backlogDir,
        ],
        env: mcpServerEnv(request.env),
      },
    },
    // `--allowedTools` only auto-approves; it excludes nothing.
    allowedTools: context.mcpTools.map((name) => `mcp__${MCP_SERVER_NAME}__${name}`),
    // The agent keeps every built-in tool it needs to do the work; the table
    // closes only the route back into Backlog's own CLI — and does so on
    // every run, unconditionally, because every run gets the façade to use
    // instead.
    disallowedTools: executionDeniedBuiltins(),
    // The user's own MCP servers stay available to a coding agent — see the
    // note on strictMcpConfig in command.ts. The other edge of that trade-off:
    // without `--strict-mcp-config` the CLI also loads project-scoped
    // `.mcp.json` from the worktree, so a server named `backlog` committed to
    // the repository would collide with the one declared here. Keeping the
    // user's servers is the deliberate choice; the collision is the price.
    strictMcpConfig: context.userMcpServers === "hidden",
  });
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
    const command = buildRunCommand(request);

    // The CLI emits one NDJSON line per agent-loop event. We forward each
    // recognised one as it lands so the board shows tool calls live instead
    // of a silent gap, and keep the last `result` line for usage totals.
    let resultLine: string | null = null;
    const spawned = await spawnStreaming({
      executable: command.executable,
      args: command.args,
      cwd: request.cwd,
      env: this.runEnvironmentFor(request),
      input: command.stdin,
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
    const { text, model, usage } = await this.runCompletion(request, { systemPrompt: request.systemPrompt });
    if (text.trim().length === 0) {
      throw new Error("Claude Code returned an empty answer.");
    }
    return { text: text.trim(), model, usage };
  }

  async completeStructured<T>(request: ProviderStructuredRequest): Promise<ProviderStructuredResult<T>> {
    // `--json-schema` makes the CLI enforce the shape and hand back an already
    // parsed object in `structured_output`. The text fallback covers a CLI old
    // enough not to have the flag.
    const { text, structured, model, usage } = await this.runCompletion(request, {
      systemPrompt: request.systemPrompt,
      jsonSchema: request.schema,
    });
    const value = structured ?? parseJsonObject(text, "Claude Code");
    return { value: value as T, model, usage };
  }

  /**
   * One non-interactive turn with tools switched off. The CLI is a coding
   * agent by default; for a naming or planning question we want it to answer
   * from the prompt alone rather than crawl the checkout.
   */
  private async runCompletion(
    request: ProviderCompletionRequest,
    options: { systemPrompt?: string | undefined; jsonSchema?: Record<string, unknown> | undefined },
  ): Promise<{ text: string; structured: unknown; model: string; usage: UsageBlock | null }> {
    const model = request.model ?? request.agent?.model;
    const context = contextFor("completion");
    const command = buildClaudeCodeCommand({
      executable: resolveExecutable(request.command ?? claudeExecutableFor(request.agent ?? {})),
      prompt: request.prompt,
      model,
      outputFormat: "json",
      disallowedTools: context.deniedBuiltins,
      // No servers of our own, and none of the user's either: a question about
      // a ticket's title has no use for them and would pay their tool schemas
      // in context.
      strictMcpConfig: context.userMcpServers === "hidden",
      ...(options.systemPrompt ? { systemPrompt: options.systemPrompt } : {}),
      ...(options.jsonSchema ? { jsonSchema: options.jsonSchema } : {}),
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
      input: command.stdin,
    });

    if (spawned.exitCode !== 0) {
      const detail = (spawned.stderr || spawned.stdout).trim().slice(0, 400);
      throw new Error(`Claude Code failed (${describeProcessFailure(spawned)}): ${detail}`);
    }

    const parsed = parseClaudeJsonStdout(spawned.stdout, model ?? this.id);
    return {
      text: parsed.summary ?? spawned.stdout,
      structured: parsed.structured,
      model: parsed.usage?.model ?? model ?? this.id,
      usage: parsed.usage,
    };
  }

  /**
   * A coding run's environment: the auth overlay, plus the CLI role every run
   * carries now that the façade is unconditional. `run-executor.ts`
   * deliberately stamps no role — it is runtime-agnostic, and whether the
   * Backlog CLI is replaced by anything is a fact about the runtime, not
   * about the pipeline.
   */
  private runEnvironmentFor(request: ProviderRunRequest): NodeJS.ProcessEnv {
    const env = this.environmentFor(request);
    const role = executionCliRole();
    return role ? { ...env, [AGENT_ROLE_ENV]: role } : env;
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
