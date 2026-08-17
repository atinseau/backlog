import { describe, expect, it } from "bun:test";
import type { Agent } from "@backlog/schemas";
import { AnthropicApiProvider, type AnthropicMessagesClient } from "./provider.js";

interface RecordedCall {
  model: string;
  system?: unknown;
  messages: unknown;
  output_config?: unknown;
  max_tokens: number;
}

/** A stand-in for the Anthropic SDK that records the request and replays a canned answer. */
function fakeClient(text: string): { client: AnthropicMessagesClient; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const client: AnthropicMessagesClient = {
    async create(params) {
      calls.push(params as unknown as RecordedCall);
      return {
        content: [{ type: "text", text }],
        usage: { input_tokens: 30, output_tokens: 12 },
      };
    },
  };
  return { client, calls };
}

function providerWith(text: string) {
  const { client, calls } = fakeClient(text);
  return {
    provider: new AnthropicApiProvider({ createClient: () => client }),
    calls,
  };
}

function agentFixture(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "planner",
    provider: "anthropic-api",
    enabled: true,
    max_concurrent_runs: 1,
    allowed_repos: [],
    allowed_risk: ["low"],
    capabilities: [],
    environment: {},
    retry_policy: { mode: "none", max_attempts: 1, reuse_worktree: true },
    ...overrides,
  };
}

const withKey = (key: string) => (name: string) => (name === "ANTHROPIC_API_KEY" ? key : null);

describe("AnthropicApiProvider.describe", () => {
  it("answers prompts but cannot run coding tasks", () => {
    const { provider } = providerWith("x");

    expect(provider.describe().capabilities).toEqual({
      executeRun: false,
      textCompletion: true,
      structuredOutput: true,
    });
  });

  it("requires an API key, having no session of its own", () => {
    const { provider } = providerWith("x");

    expect(provider.describe().authModes).toEqual(["api_key"]);
  });
});

describe("AnthropicApiProvider.checkReadiness", () => {
  it("is blocked without a key", () => {
    const { provider } = providerWith("x");

    const readiness = provider.checkReadiness({ agent: agentFixture(), getSecret: () => null });

    expect(readiness.ready).toBe(false);
    expect(readiness.reasons).toContain("missing_api_key:ANTHROPIC_API_KEY");
  });

  it("is ready with a stored key", () => {
    const { provider } = providerWith("x");

    expect(provider.checkReadiness({ agent: agentFixture(), getSecret: withKey("sk-ant") })).toEqual({
      ready: true,
      reasons: [],
    });
  });
});

describe("AnthropicApiProvider.complete", () => {
  it("returns the model's text answer", async () => {
    const { provider } = providerWith("Fix the topbar dropdown");

    const completion = await provider.complete({ prompt: "name it", getSecret: withKey("sk-ant") });

    expect(completion.text).toBe("Fix the topbar dropdown");
  });

  it("reports token usage", async () => {
    const { provider } = providerWith("x");

    const completion = await provider.complete({ prompt: "p", getSecret: withKey("sk-ant") });

    expect(completion.usage).toMatchObject({ input_tokens: 30, output_tokens: 12 });
  });

  it("sends the system prompt separately from the user turn", async () => {
    const { provider, calls } = providerWith("x");

    await provider.complete({ prompt: "user text", systemPrompt: "be terse", getSecret: withKey("sk-ant") });

    expect(calls[0]?.system).toBe("be terse");
    expect(calls[0]?.messages).toEqual([{ role: "user", content: "user text" }]);
  });

  it("resolves the model alias the agent carries into a real API id", async () => {
    const { provider, calls } = providerWith("x");

    await provider.complete({ prompt: "p", agent: agentFixture({ model: "sonnet" }), getSecret: withKey("sk-ant") });

    expect(calls[0]?.model).toBe("claude-sonnet-4-6");
  });

  it("passes an exact model id straight through", async () => {
    const { provider, calls } = providerWith("x");

    await provider.complete({ prompt: "p", model: "claude-opus-4-20250514", getSecret: withKey("sk-ant") });

    expect(calls[0]?.model).toBe("claude-opus-4-20250514");
  });

  it("refuses to call the API without a key", async () => {
    const { provider } = providerWith("x");

    await expect(provider.complete({ prompt: "p", getSecret: () => null })).rejects.toThrow(
      /ANTHROPIC_API_KEY/,
    );
  });
});

describe("AnthropicApiProvider.completeStructured", () => {
  const schema = { type: "object", properties: { title: { type: "string" } }, required: ["title"] };

  it("parses the JSON the model returned", async () => {
    const { provider } = providerWith('{"title":"Add the widget"}');

    const structured = await provider.completeStructured<{ title: string }>({
      prompt: "p",
      schema,
      schemaName: "task",
      getSecret: withKey("sk-ant"),
    });

    expect(structured.value).toEqual({ title: "Add the widget" });
  });

  it("asks the API to enforce the schema natively", async () => {
    const { provider, calls } = providerWith('{"title":"x"}');

    await provider.completeStructured({ prompt: "p", schema, schemaName: "task", getSecret: withKey("sk-ant") });

    expect(calls[0]?.output_config).toEqual({ format: { type: "json_schema", schema } });
  });
});
