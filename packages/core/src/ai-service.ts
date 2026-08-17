import { getSecret } from "@backlog/config";
import type { Agent } from "@backlog/schemas";
import { getAgent } from "./agents.js";
import { providerRegistry } from "./providers/index.js";
import { resolveCompletionProvider } from "./providers/completion-provider.js";
import type { ProviderRegistry } from "./providers/registry.js";
import {
  ProviderCapabilityError,
  type ProviderCompletionResult,
  type ProviderStructuredResult,
} from "./providers/types.js";

// The one door for every AI call that is not a coding run: naming a task,
// refining its description, planning a split. Callers say what they want,
// not which runtime should provide it.

export interface ProjectCompletionInput {
  prompt: string;
  systemPrompt?: string | undefined;
  /** Agent ids to prefer, most-preferred first. Unknown ids are ignored. */
  preferredAgentIds?: string[] | undefined;
  /** Working directory for runtimes that need one. Defaults to the project. */
  cwd?: string | undefined;
  /** Injection point for tests; production callers use the shared registry. */
  registry?: ProviderRegistry | undefined;
}

export interface ProjectStructuredInput extends ProjectCompletionInput {
  schema: Record<string, unknown>;
  schemaName: string;
}

function preferredAgents(backlogDir: string, ids: string[] | undefined): Agent[] {
  if (!ids || ids.length === 0) return [];
  return ids
    .map((id) => {
      try {
        return getAgent(backlogDir, id);
      } catch {
        // A project with no agents.yaml yet is a normal state, not an error.
        return null;
      }
    })
    .filter((agent): agent is Agent => agent !== null);
}

function resolve(backlogDir: string, input: ProjectCompletionInput) {
  const getProjectSecret = (key: string): string | null => getSecret(backlogDir, key);
  const resolved = resolveCompletionProvider({
    agents: preferredAgents(backlogDir, input.preferredAgentIds),
    getSecret: getProjectSecret,
    registry: input.registry ?? providerRegistry(),
  });
  return { ...resolved, getSecret: getProjectSecret };
}

export async function completeTextForProject(
  backlogDir: string,
  input: ProjectCompletionInput,
): Promise<ProviderCompletionResult> {
  const { provider, agent, getSecret: getProjectSecret } = resolve(backlogDir, input);
  if (!provider.complete) {
    throw new ProviderCapabilityError(provider.id, "text completion");
  }
  return provider.complete({
    prompt: input.prompt,
    systemPrompt: input.systemPrompt,
    agent: agent ?? undefined,
    cwd: input.cwd,
    getSecret: getProjectSecret,
  });
}

export async function completeJsonForProject<T>(
  backlogDir: string,
  input: ProjectStructuredInput,
): Promise<ProviderStructuredResult<T>> {
  const { provider, agent, getSecret: getProjectSecret } = resolve(backlogDir, input);
  if (!provider.completeStructured) {
    throw new ProviderCapabilityError(provider.id, "structured output");
  }
  return provider.completeStructured<T>({
    prompt: input.prompt,
    systemPrompt: input.systemPrompt,
    schema: input.schema,
    schemaName: input.schemaName,
    agent: agent ?? undefined,
    cwd: input.cwd,
    getSecret: getProjectSecret,
  });
}
