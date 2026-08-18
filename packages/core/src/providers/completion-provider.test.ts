import { describe, expect, it } from "bun:test";
import type { Agent } from "@backlog/schemas";
import { resolveCompletionProvider, CompletionUnavailableError } from "./completion-provider.js";
import { createProviderRegistry } from "./registry.js";
import type { AgentProvider, ProviderDescriptor } from "./types.js";

function stubProvider(
  id: string,
  options: { textCompletion?: boolean; ready?: boolean; aliases?: string[]; executeRun?: boolean } = {},
): AgentProvider {
  const descriptor: ProviderDescriptor = {
    id,
    displayName: id,
    models: [],
    reasoning: { supported: false, levels: [], allowsCustom: false },
    authModes: ["auto"],
    capabilities: {
      executeRun: options.executeRun ?? true,
      textCompletion: options.textCompletion ?? true,
      structuredOutput: options.textCompletion ?? true,
    },
    requiresCommand: false,
  };
  return {
    id,
    aliases: options.aliases ?? [],
    describe: () => descriptor,
    checkReadiness: () =>
      options.ready === false ? { ready: false, reasons: [`not_ready:${id}`] } : { ready: true, reasons: [] },
    complete: async () => ({ text: "", model: id, usage: null }),
  };
}

function agentFixture(id: string, provider: string, model?: string): Agent {
  return {
    id,
    provider,
    ...(model ? { model } : {}),
    enabled: true,
    max_concurrent_runs: 1,
    allowed_repos: [],
    allowed_risk: ["low"],
    capabilities: [],
    environment: {},
    retry_policy: { mode: "none", max_attempts: 1, reuse_worktree: true },
  };
}

const noSecrets = () => null;

describe("resolveCompletionProvider", () => {
  it("uses the agent the caller preferred", () => {
    const registry = createProviderRegistry([stubProvider("anthropic-api"), stubProvider("claude-code")]);
    const agent = agentFixture("my-claude", "claude-code", "opus");

    const resolved = resolveCompletionProvider({ agents: [agent], getSecret: noSecrets, registry });

    expect(resolved.provider.id).toBe("claude-code");
    expect(resolved.agent).toBe(agent);
  });

  it("skips a preferred agent whose runtime cannot answer prompts", () => {
    const registry = createProviderRegistry([
      stubProvider("codex", { textCompletion: false }),
      stubProvider("claude-code"),
    ]);

    const resolved = resolveCompletionProvider({
      agents: [agentFixture("my-codex", "codex")],
      getSecret: noSecrets,
      registry,
    });

    expect(resolved.provider.id).toBe("claude-code");
    expect(resolved.agent).toBeNull();
  });

  it("skips a preferred agent whose runtime is not ready", () => {
    const registry = createProviderRegistry([
      stubProvider("anthropic-api", { ready: false }),
      stubProvider("claude-code"),
    ]);

    const resolved = resolveCompletionProvider({
      agents: [agentFixture("planner", "anthropic-api")],
      getSecret: noSecrets,
      registry,
    });

    expect(resolved.provider.id).toBe("claude-code");
  });

  it("prefers a prompt-only runtime over a full coding agent", () => {
    // A coding agent can answer a question, but spinning one up to name a
    // task is the slow, expensive way round.
    const registry = createProviderRegistry([
      stubProvider("claude-code"),
      stubProvider("anthropic-api", { executeRun: false }),
    ]);

    const resolved = resolveCompletionProvider({ agents: [], getSecret: noSecrets, registry });

    expect(resolved.provider.id).toBe("anthropic-api");
    expect(resolved.agent).toBeNull();
  });

  it("uses a coding agent when the prompt-only runtime is not configured", () => {
    const registry = createProviderRegistry([
      stubProvider("claude-code"),
      stubProvider("anthropic-api", { executeRun: false, ready: false }),
    ]);

    const resolved = resolveCompletionProvider({ agents: [], getSecret: noSecrets, registry });

    expect(resolved.provider.id).toBe("claude-code");
  });

  it("falls through to the next runtime when the first is not ready", () => {
    const registry = createProviderRegistry([
      stubProvider("anthropic-api", { ready: false }),
      stubProvider("claude-code"),
    ]);

    const resolved = resolveCompletionProvider({ agents: [], getSecret: noSecrets, registry });

    expect(resolved.provider.id).toBe("claude-code");
  });

  it("explains itself when nothing can answer a prompt", () => {
    const registry = createProviderRegistry([
      stubProvider("anthropic-api", { ready: false }),
      stubProvider("claude-code", { ready: false }),
    ]);

    expect(() => resolveCompletionProvider({ agents: [], getSecret: noSecrets, registry })).toThrow(
      CompletionUnavailableError,
    );
  });

  it("names every runtime it tried, so the user knows what to fix", () => {
    const registry = createProviderRegistry([stubProvider("anthropic-api", { ready: false })]);

    expect(() => resolveCompletionProvider({ agents: [], getSecret: noSecrets, registry })).toThrow(
      /not_ready:anthropic-api/,
    );
  });

  it("tries preferred agents in order", () => {
    const registry = createProviderRegistry([
      stubProvider("anthropic-api"),
      stubProvider("claude-code"),
      stubProvider("codex", { textCompletion: false }),
    ]);

    const resolved = resolveCompletionProvider({
      agents: [agentFixture("a", "codex"), agentFixture("b", "claude-code")],
      getSecret: noSecrets,
      registry,
    });

    expect(resolved.agent?.id).toBe("b");
  });
});
