import type { Agent, AgentAuthMode, SandboxMode } from "@backlog/schemas";
import type { UsageBlock } from "../provider-usage.js";

// The provider contract. Everything the product does with an LLM goes
// through one of these methods — running a coding task, naming a task,
// refining a description, proposing a split. Adding a runtime means adding
// one class here, not another branch in five call sites.

export type ProviderId = string;

/** One line in the live activity banner. */
export interface ProviderActivityEvent {
  type: string;
  message: string;
}

/** A model the provider suggests. The list is a catalogue, never a whitelist. */
export interface ProviderModelChoice {
  value: string;
  label: string;
  family?: string;
  description: string;
}

export interface ProviderReasoningLevel {
  value: string;
  label: string;
  description: string;
}

export interface ProviderReasoningSupport {
  supported: boolean;
  levels: ProviderReasoningLevel[];
  /** True when a value outside `levels` is still forwarded to the runtime. */
  allowsCustom: boolean;
  /** Level applied when the user expresses no preference. */
  defaultLevel?: string;
}

export interface ProviderCapabilities {
  /** Can drive a coding task end to end in a checkout. */
  executeRun: boolean;
  /** Can answer a one-shot prompt with free text. */
  textCompletion: boolean;
  /** Can answer a one-shot prompt with schema-shaped JSON. */
  structuredOutput: boolean;
}

export interface ProviderDescriptor {
  id: ProviderId;
  displayName: string;
  models: ProviderModelChoice[];
  reasoning: ProviderReasoningSupport;
  authModes: AgentAuthMode[];
  sandboxModes: SandboxMode[];
  capabilities: ProviderCapabilities;
  /** True when the agent must carry its own `command` (generic runtimes). */
  requiresCommand: boolean;
}

export interface ProviderReadiness {
  ready: boolean;
  /** Machine-readable codes, e.g. `missing_executable:claude`. Empty when ready. */
  reasons: string[];
}

export interface ProviderReadinessInput {
  agent: Agent;
  /** Reads a secret from the project/account store. */
  getSecret: (key: string) => string | null;
}

export interface ProviderRunRequest {
  agent: Agent;
  prompt: string;
  cwd: string;
  /**
   * The project this run belongs to. Not derivable from `cwd`: an in_repo
   * project's worktree carries a shadow `.backlog/config.toml`, so walking up
   * from the worktree finds the wrong project. Runtimes that spawn Backlog's
   * own MCP server pass it through explicitly.
   */
  backlogDir: string;
  /** Where a runtime may drop its own scratch files. Defaults to `cwd`. */
  scratchDir?: string | undefined;
  /** Base environment; the provider overlays its own auth on top. */
  env: NodeJS.ProcessEnv;
  reasoningEffort?: string | undefined;
  getSecret: (key: string) => string | null;
  onActivity: (event: ProviderActivityEvent) => void;
}

export interface ProviderRunResult {
  ok: boolean;
  /** The agent's closing message, when it produced one. */
  summary: string | null;
  usage: UsageBlock | null;
  stdout: string;
  stderr: string;
  /** Human-readable cause when `ok` is false, e.g. `exit code 1`. */
  failure?: string;
}

export interface ProviderCompletionRequest {
  prompt: string;
  systemPrompt?: string | undefined;
  model?: string | undefined;
  /** Auth and model defaults are taken from this agent when present. */
  agent?: Agent | undefined;
  /** Executable override; falls back to the agent's, then the provider default. */
  command?: string | undefined;
  getSecret: (key: string) => string | null;
  /** Where to run, for runtimes that need a working directory. */
  cwd?: string | undefined;
}

export interface ProviderCompletionResult {
  text: string;
  model: string;
  usage: UsageBlock | null;
}

export interface ProviderStructuredRequest extends ProviderCompletionRequest {
  /** JSON Schema the answer must satisfy. */
  schema: Record<string, unknown>;
  schemaName: string;
}

export interface ProviderStructuredResult<T> {
  value: T;
  model: string;
  usage: UsageBlock | null;
}

/**
 * A runtime capable of answering prompts. Optional methods mirror
 * `describe().capabilities`; callers check the descriptor rather than
 * probing for the method.
 */
export interface AgentProvider {
  readonly id: ProviderId;
  /** Provider ids accepted in agents.yaml that resolve to this class. */
  readonly aliases: readonly string[];

  describe(): ProviderDescriptor;
  checkReadiness(input: ProviderReadinessInput): ProviderReadiness;

  executeRun?(request: ProviderRunRequest): Promise<ProviderRunResult>;
  complete?(request: ProviderCompletionRequest): Promise<ProviderCompletionResult>;
  completeStructured?<T>(request: ProviderStructuredRequest): Promise<ProviderStructuredResult<T>>;
}

/** Raised when a provider is asked for something its descriptor does not advertise. */
export class ProviderCapabilityError extends Error {
  constructor(providerId: ProviderId, capability: string) {
    super(`Provider ${providerId} does not support ${capability}.`);
    this.name = "ProviderCapabilityError";
  }
}
