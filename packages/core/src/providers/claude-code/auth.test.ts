import { describe, expect, it } from "bun:test";
import { resolveClaudeCodeAuth } from "./auth.js";

describe("resolveClaudeCodeAuth", () => {
  it("uses the stored API key when one is available", () => {
    const auth = resolveClaudeCodeAuth({ authMode: "auto", storedApiKey: "sk-ant-stored" });

    expect(auth.mode).toBe("api_key");
    expect(auth.env.ANTHROPIC_API_KEY).toBe("sk-ant-stored");
  });

  it("falls back to the CLI's own session when no key is stored", () => {
    const auth = resolveClaudeCodeAuth({ authMode: "auto", storedApiKey: null });

    expect(auth.mode).toBe("subscription");
  });

  it("never leaks a stored key when the agent is pinned to its subscription", () => {
    const auth = resolveClaudeCodeAuth({ authMode: "subscription", storedApiKey: "sk-ant-stored" });

    expect(auth.mode).toBe("subscription");
    expect(auth.env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("unsets an inherited shell key in subscription mode so billing stays on the plan", () => {
    const auth = resolveClaudeCodeAuth({
      authMode: "subscription",
      storedApiKey: null,
      inheritedApiKey: "sk-ant-from-shell",
    });

    expect(auth.env).toHaveProperty("ANTHROPIC_API_KEY");
    expect(auth.env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("prefers an inherited shell key over the stored one in auto mode", () => {
    const auth = resolveClaudeCodeAuth({
      authMode: "auto",
      storedApiKey: "sk-ant-stored",
      inheritedApiKey: "sk-ant-from-shell",
    });

    expect(auth.mode).toBe("api_key");
    expect(auth.env.ANTHROPIC_API_KEY).toBe("sk-ant-from-shell");
  });

  it("reports why an api_key-pinned agent cannot run without a key", () => {
    const auth = resolveClaudeCodeAuth({ authMode: "api_key", storedApiKey: null });

    expect(auth.mode).toBe("api_key");
    expect(auth.missingReason).toBe("missing_api_key:ANTHROPIC_API_KEY");
  });

  it("has no missing reason once the pinned key is present", () => {
    const auth = resolveClaudeCodeAuth({ authMode: "api_key", storedApiKey: "sk-ant-stored" });

    expect(auth.missingReason).toBeUndefined();
  });

  it("defaults to auto when no auth mode is configured", () => {
    const auth = resolveClaudeCodeAuth({ storedApiKey: null });

    expect(auth.mode).toBe("subscription");
    expect(auth.missingReason).toBeUndefined();
  });
});
