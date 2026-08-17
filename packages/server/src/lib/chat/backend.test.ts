import { describe, expect, it } from "bun:test";
import { selectChatBackend, ChatUnavailableError } from "./backend.js";

// Which engine answers the chat. The API key path is preferred when a key
// exists — it is faster and its tool loop is native — and the CLI path is what
// makes the feature work on a subscription.

const withKey = (key: string | null) => (name: string) => (name === "ANTHROPIC_API_KEY" ? key : null);

describe("selectChatBackend", () => {
  it("uses the API when a key is configured", () => {
    const backend = selectChatBackend({ getSecret: withKey("sk-ant-stored"), claudeInstalled: true });

    expect(backend.kind).toBe("anthropic-api");
  });

  it("passes the key through so the caller does not resolve it twice", () => {
    const backend = selectChatBackend({ getSecret: withKey("sk-ant-stored"), claudeInstalled: false });

    expect(backend.kind === "anthropic-api" && backend.apiKey).toBe("sk-ant-stored");
  });

  it("falls back to the local CLI when there is no key", () => {
    const backend = selectChatBackend({ getSecret: withKey(null), claudeInstalled: true });

    expect(backend.kind).toBe("claude-code");
  });

  it("explains itself when neither a key nor the CLI is available", () => {
    expect(() => selectChatBackend({ getSecret: withKey(null), claudeInstalled: false })).toThrow(
      ChatUnavailableError,
    );
  });

  it("names both remedies in that error, so the user can pick one", () => {
    try {
      selectChatBackend({ getSecret: withKey(null), claudeInstalled: false });
      throw new Error("should have thrown");
    } catch (error) {
      expect((error as Error).message).toContain("ANTHROPIC_API_KEY");
      expect((error as Error).message).toContain("claude");
    }
  });

  it("can be forced onto the CLI even when a key exists", () => {
    const backend = selectChatBackend({
      getSecret: withKey("sk-ant-stored"),
      claudeInstalled: true,
      prefer: "claude-code",
    });

    expect(backend.kind).toBe("claude-code");
  });

  it("ignores a preference the environment cannot satisfy", () => {
    const backend = selectChatBackend({
      getSecret: withKey("sk-ant-stored"),
      claudeInstalled: false,
      prefer: "claude-code",
    });

    expect(backend.kind).toBe("anthropic-api");
  });
});
