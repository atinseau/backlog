import { describe, expect, it } from "vitest";
import { parseClaudeJsonStdout, parseCodexJsonStream } from "./provider-usage.js";

describe("parseClaudeJsonStdout", () => {
  it("extracts usage + summary from Claude --output-format json output", () => {
    const stdout = JSON.stringify({
      summary: "Done.",
      usage: {
        input_tokens: 1500,
        output_tokens: 400,
        cache_read_input_tokens: 200,
        cache_creation_input_tokens: 50,
      },
    });
    const { usage, summary } = parseClaudeJsonStdout(stdout, "claude-sonnet-4-6");
    expect(summary).toBe("Done.");
    expect(usage).toEqual({
      model: "claude-sonnet-4-6",
      input_tokens: 1500,
      output_tokens: 400,
      cache_read_input_tokens: 200,
      cache_creation_input_tokens: 50,
    });
  });

  it("falls back to .result when there's no .summary field", () => {
    const stdout = JSON.stringify({
      result: "Result text",
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    expect(parseClaudeJsonStdout(stdout, "claude-haiku-4-5").summary).toBe("Result text");
  });

  it("returns null for non-JSON output (legacy text mode)", () => {
    const { usage, summary } = parseClaudeJsonStdout(
      "Plain text answer with no JSON",
      "claude-sonnet-4-6",
    );
    expect(usage).toBeNull();
    expect(summary).toBeNull();
  });

  it("uses the model from the JSON when present, fallback otherwise", () => {
    const stdoutWithModel = JSON.stringify({
      usage: { input_tokens: 1, output_tokens: 1, model: "claude-opus-4-1" },
    });
    expect(parseClaudeJsonStdout(stdoutWithModel, "fallback").usage?.model).toBe("claude-opus-4-1");

    const stdoutNoModel = JSON.stringify({ usage: { input_tokens: 1, output_tokens: 1 } });
    expect(parseClaudeJsonStdout(stdoutNoModel, "fallback").usage?.model).toBe("fallback");
  });
});

describe("parseCodexJsonStream", () => {
  it("returns the last usage block in a multi-line JSON stream", () => {
    const stdout = [
      JSON.stringify({ type: "agent_message", text: "thinking..." }),
      JSON.stringify({ type: "session.usage", usage: { input_tokens: 50, output_tokens: 20 } }),
      JSON.stringify({ type: "agent_message", text: "more thinking..." }),
      JSON.stringify({ type: "session.usage", usage: { input_tokens: 200, output_tokens: 100 } }),
    ].join("\n");
    const usage = parseCodexJsonStream(stdout, "gpt-5");
    // The last usage block wins — codex reports cumulative-per-turn.
    expect(usage).toEqual({
      model: "gpt-5",
      input_tokens: 200,
      output_tokens: 100,
    });
  });

  it("tolerates malformed JSON lines without crashing", () => {
    const stdout = [
      "not json at all",
      JSON.stringify({ usage: { input_tokens: 7, output_tokens: 3 } }),
      "{ broken",
    ].join("\n");
    const usage = parseCodexJsonStream(stdout, "gpt-5");
    expect(usage?.input_tokens).toBe(7);
  });

  it("returns null when no line carries a usage block", () => {
    const stdout = [
      JSON.stringify({ type: "agent_message", text: "hi" }),
      JSON.stringify({ type: "agent_message", text: "bye" }),
    ].join("\n");
    expect(parseCodexJsonStream(stdout, "gpt-5")).toBeNull();
  });

  it("digs into a payload wrapper if usage is nested", () => {
    const stdout = JSON.stringify({
      event: "usage",
      payload: { usage: { input_tokens: 42, output_tokens: 17 } },
    });
    expect(parseCodexJsonStream(stdout, "gpt-5")?.input_tokens).toBe(42);
  });
});
