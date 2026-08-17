import { describe, expect, it } from "bun:test";
import { isClaudeCodeResultLine, parseClaudeCodeStreamLine } from "./stream.js";

function toolUse(name: string, input: Record<string, unknown>): string {
  return JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "tool_use", name, input }] },
  });
}

describe("parseClaudeCodeStreamLine", () => {
  it("announces the session with its model and tool count", () => {
    const events = parseClaudeCodeStreamLine(
      JSON.stringify({ type: "system", subtype: "init", model: "claude-opus-4-7", tools: ["Read", "Bash"] }),
    );

    expect(events).toEqual([{ type: "agent.session_init", message: "model=claude-opus-4-7 tools=2" }]);
  });

  it("classifies file reads", () => {
    expect(parseClaudeCodeStreamLine(toolUse("Read", { file_path: "src/app.ts" }))).toEqual([
      { type: "agent.read", message: "Read src/app.ts" },
    ]);
  });

  it("classifies edits and writes apart from reads", () => {
    expect(parseClaudeCodeStreamLine(toolUse("Edit", { file_path: "a.ts" }))[0]?.type).toBe("agent.edit");
    expect(parseClaudeCodeStreamLine(toolUse("Write", { file_path: "a.ts" }))[0]?.type).toBe("agent.write");
  });

  it("prefers a bash description over the raw command", () => {
    expect(parseClaudeCodeStreamLine(toolUse("Bash", { command: "npm test -- --watch=false", description: "Run tests" }))).toEqual([
      { type: "agent.bash", message: "Bash Run tests" },
    ]);
  });

  it("falls back to the raw command when bash has no description", () => {
    expect(parseClaudeCodeStreamLine(toolUse("Bash", { command: "ls -la" }))).toEqual([
      { type: "agent.bash", message: "Bash ls -la" },
    ]);
  });

  it("truncates long summaries so the activity banner stays on one line", () => {
    const message = parseClaudeCodeStreamLine(toolUse("Bash", { command: "x".repeat(200) }))[0]!.message;

    expect(message.length).toBeLessThanOrEqual(85);
    expect(message.endsWith("…")).toBe(true);
  });

  it("labels unknown tools generically without losing the name", () => {
    expect(parseClaudeCodeStreamLine(toolUse("SomeFutureTool", {}))).toEqual([
      { type: "agent.tool", message: "SomeFutureTool" },
    ]);
  });

  it("emits one event per tool call in a multi-tool turn", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "let me look" },
          { type: "tool_use", name: "Read", input: { file_path: "a.ts" } },
          { type: "tool_use", name: "Grep", input: { pattern: "foo" } },
        ],
      },
    });

    expect(parseClaudeCodeStreamLine(line).map((event) => event.type)).toEqual(["agent.read", "agent.read"]);
  });

  it("stays silent on tool results and lifecycle events", () => {
    expect(parseClaudeCodeStreamLine(JSON.stringify({ type: "user", message: { content: [] } }))).toEqual([]);
    expect(parseClaudeCodeStreamLine(JSON.stringify({ type: "result", usage: {} }))).toEqual([]);
  });

  it("ignores non-JSON noise on stdout", () => {
    expect(parseClaudeCodeStreamLine("Warning: something happened")).toEqual([]);
    expect(parseClaudeCodeStreamLine("")).toEqual([]);
  });
});

describe("isClaudeCodeResultLine", () => {
  it("recognises the closing result event", () => {
    expect(isClaudeCodeResultLine(JSON.stringify({ type: "result", result: "done" }))).toBe(true);
  });

  it("is not fooled by a tool call that merely mentions the word result", () => {
    const line = toolUse("Bash", { command: 'grep -r "result" src/' });

    expect(isClaudeCodeResultLine(line)).toBe(false);
  });

  it("rejects non-JSON lines", () => {
    expect(isClaudeCodeResultLine("result")).toBe(false);
  });
});
