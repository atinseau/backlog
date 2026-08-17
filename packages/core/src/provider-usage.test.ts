import { describe, expect, it } from "bun:test";
import { parseClaudeJsonStdout } from "./provider-usage.js";

// Shape of `claude -p --output-format json`, as observed from the CLI.
function payload(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "Fix the topbar dropdown",
    session_id: "86fcc87a-1e74-4bfb-bf30-f1edca6aaf4a",
    usage: { input_tokens: 2, output_tokens: 510, cache_creation_input_tokens: 28378 },
    ...extra,
  });
}

describe("parseClaudeJsonStdout", () => {
  it("reads the answer text", () => {
    expect(parseClaudeJsonStdout(payload(), "sonnet").summary).toBe("Fix the topbar dropdown");
  });

  it("reads token usage, cache included", () => {
    expect(parseClaudeJsonStdout(payload(), "sonnet").usage).toMatchObject({
      input_tokens: 2,
      output_tokens: 510,
      cache_creation_input_tokens: 28378,
    });
  });

  it("returns the object the CLI parsed for us under --json-schema", () => {
    const parsed = parseClaudeJsonStdout(
      payload({ structured_output: { title: "Fix it", risk: "low" } }),
      "sonnet",
    );

    expect(parsed.structured).toEqual({ title: "Fix it", risk: "low" });
  });

  it("has no structured output when the schema flag was not used", () => {
    expect(parseClaudeJsonStdout(payload(), "sonnet").structured).toBeNull();
  });

  it("ignores a structured_output that is not an object", () => {
    expect(parseClaudeJsonStdout(payload({ structured_output: "nope" }), "sonnet").structured).toBeNull();
  });

  it("survives output that is not JSON at all", () => {
    expect(parseClaudeJsonStdout("command not found", "sonnet")).toEqual({
      usage: null,
      summary: null,
      structured: null,
    });
  });

  it("reports the session id, so a conversation can be resumed", () => {
    expect(parseClaudeJsonStdout(payload(), "sonnet").sessionId).toBe("86fcc87a-1e74-4bfb-bf30-f1edca6aaf4a");
  });
});
