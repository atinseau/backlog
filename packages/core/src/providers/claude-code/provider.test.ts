import { describe, expect, it } from "bun:test";
import type { Agent } from "@backlog/schemas";
import { ClaudeCodeProvider } from "./provider.js";

function agentFixture(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "claude-default",
    provider: "claude",
    enabled: true,
    max_concurrent_runs: 1,
    allowed_repos: [],
    allowed_risk: ["low", "medium"],
    capabilities: ["plan", "edit_code"],
    environment: {},
    retry_policy: { mode: "none", max_attempts: 2, reuse_worktree: true },
    ...overrides,
  };
}

function providerWith(options: { installed?: boolean } = {}): ClaudeCodeProvider {
  return new ClaudeCodeProvider({ executableExists: () => options.installed ?? true });
}

const noSecrets = () => null;

describe("ClaudeCodeProvider.describe", () => {
  it("answers to the legacy `claude` provider id", () => {
    expect(providerWith().aliases).toContain("claude");
  });

  it("advertises a model catalogue that stays open to unlisted values", () => {
    const descriptor = providerWith().describe();

    expect(descriptor.models.map((model) => model.value)).toContain("sonnet");
    expect(descriptor.models.map((model) => model.value)).toContain("opus");
    expect(descriptor.models.length).toBeGreaterThan(2);
  });

  it("supports reasoning effort and forwards unlisted levels", () => {
    const { reasoning } = providerWith().describe();

    expect(reasoning.supported).toBe(true);
    expect(reasoning.allowsCustom).toBe(true);
    expect(reasoning.defaultLevel).toBe("medium");
  });

  it("lists exactly the effort levels the CLI accepts", () => {
    const { reasoning } = providerWith().describe();

    expect(reasoning.levels.map((level) => level.value)).toEqual(["low", "medium", "high", "xhigh", "max"]);
  });

  it("can both run tasks and answer one-shot prompts", () => {
    const { capabilities } = providerWith().describe();

    expect(capabilities).toEqual({ executeRun: true, textCompletion: true, structuredOutput: true });
  });

  it("offers the subscription as a first-class auth mode", () => {
    expect(providerWith().describe().authModes).toEqual(["auto", "subscription", "api_key"]);
  });
});

describe("ClaudeCodeProvider.checkReadiness", () => {
  it("is ready without any API key, because the CLI carries its own session", () => {
    const readiness = providerWith({ installed: true }).checkReadiness({
      agent: agentFixture(),
      getSecret: noSecrets,
    });

    expect(readiness).toEqual({ ready: true, reasons: [] });
  });

  it("reports a missing executable", () => {
    const readiness = providerWith({ installed: false }).checkReadiness({
      agent: agentFixture(),
      getSecret: noSecrets,
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.reasons).toContain("missing_executable:claude");
  });

  it("names the custom executable when the agent overrides it", () => {
    const readiness = providerWith({ installed: false }).checkReadiness({
      agent: agentFixture({ command: "/opt/claude" }),
      getSecret: noSecrets,
    });

    expect(readiness.reasons).toContain("missing_executable:/opt/claude");
  });

  it("blocks an api_key-pinned agent until the key exists", () => {
    const readiness = providerWith({ installed: true }).checkReadiness({
      agent: agentFixture({ auth_mode: "api_key" }),
      getSecret: noSecrets,
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.reasons).toContain("missing_api_key:ANTHROPIC_API_KEY");
  });

  it("clears an api_key-pinned agent once the key is stored", () => {
    const readiness = providerWith({ installed: true }).checkReadiness({
      agent: agentFixture({ auth_mode: "api_key" }),
      getSecret: (key) => (key === "ANTHROPIC_API_KEY" ? "sk-ant-stored" : null),
    });

    expect(readiness).toEqual({ ready: true, reasons: [] });
  });

  it("stays ready in subscription mode even with no key anywhere", () => {
    const readiness = providerWith({ installed: true }).checkReadiness({
      agent: agentFixture({ auth_mode: "subscription" }),
      getSecret: noSecrets,
    });

    expect(readiness.ready).toBe(true);
  });
});
