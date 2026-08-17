import type { Agent } from "@backlog/schemas";
import type { ProviderRegistry } from "./registry.js";
import type { AgentProvider } from "./types.js";

// Picking a runtime for the prompts that are not coding runs: naming a task,
// refining its description, proposing a split. These need a model but no
// checkout, so any provider advertising textCompletion will do.

export class CompletionUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompletionUnavailableError";
  }
}

export interface CompletionProviderInput {
  /** Preferred agents, most-preferred first. Their runtime wins when usable. */
  agents: Agent[];
  getSecret: (key: string) => string | null;
  registry: ProviderRegistry;
}

export interface ResolvedCompletionProvider {
  provider: AgentProvider;
  /** The agent whose configuration (model, auth) applies, when one was chosen. */
  agent: Agent | null;
}

function canAnswerPrompts(provider: AgentProvider): boolean {
  return provider.describe().capabilities.textCompletion && typeof provider.complete === "function";
}

/**
 * Prompt-only runtimes first. A coding agent can answer a question, but
 * booting one to name a task is the slow and expensive way round — so it is
 * the fallback's fallback, used when no direct model access is configured.
 */
function fallbackOrder(providers: AgentProvider[]): AgentProvider[] {
  const promptOnly = providers.filter((provider) => !provider.describe().capabilities.executeRun);
  const rest = providers.filter((provider) => provider.describe().capabilities.executeRun);
  return [...promptOnly, ...rest];
}

/**
 * Resolve which runtime answers a one-shot prompt.
 *
 * A preferred agent wins when its runtime can answer and is ready — that is
 * how "plan this task with Opus" stays honest. Otherwise we walk the registry
 * in order, so a machine with an API key keeps using it and a machine with
 * only the Claude Code CLI still gets the feature.
 *
 * @throws CompletionUnavailableError listing why each candidate was rejected.
 */
export function resolveCompletionProvider(input: CompletionProviderInput): ResolvedCompletionProvider {
  const rejections: string[] = [];

  for (const agent of input.agents) {
    const provider = input.registry.resolve(agent.provider);
    if (!provider || !canAnswerPrompts(provider)) continue;
    const readiness = provider.checkReadiness({ agent, getSecret: input.getSecret });
    if (readiness.ready) return { provider, agent };
    rejections.push(...readiness.reasons);
  }

  for (const provider of fallbackOrder(input.registry.list())) {
    if (!canAnswerPrompts(provider)) continue;
    const readiness = provider.checkReadiness({
      agent: syntheticAgent(provider.id),
      getSecret: input.getSecret,
    });
    if (readiness.ready) return { provider, agent: null };
    rejections.push(...readiness.reasons);
  }

  throw new CompletionUnavailableError(
    `No AI runtime is available for this request. Tried: ${[...new Set(rejections)].join(", ") || "none"}.`,
  );
}

/** Minimal agent shape for asking a provider "could you run at all?". */
function syntheticAgent(providerId: string): Agent {
  return {
    id: `${providerId}-default`,
    provider: providerId,
    enabled: true,
    max_concurrent_runs: 1,
    allowed_repos: [],
    allowed_risk: ["low", "medium"],
    capabilities: [],
    environment: {},
    retry_policy: { mode: "none", max_attempts: 1, reuse_worktree: true },
  };
}
