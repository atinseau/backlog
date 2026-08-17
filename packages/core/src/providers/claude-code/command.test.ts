import { describe, expect, it } from "bun:test";
import { buildClaudeCodeCommand } from "./command.js";

describe("buildClaudeCodeCommand", () => {
  it("streams NDJSON and puts the prompt last", () => {
    const command = buildClaudeCodeCommand({ executable: "claude", prompt: "do the thing" });

    expect(command.executable).toBe("claude");
    expect(command.args.slice(0, 4)).toEqual(["-p", "--output-format", "stream-json", "--verbose"]);
    expect(command.args.at(-1)).toBe("do the thing");
  });

  it("bypasses permissions by default", () => {
    const command = buildClaudeCodeCommand({ executable: "claude", prompt: "x" });

    expect(command.args).toContain("--permission-mode");
    expect(command.args[command.args.indexOf("--permission-mode") + 1]).toBe("bypassPermissions");
  });

  it("downgrades to plan mode when the agent is sandboxed read-only", () => {
    const command = buildClaudeCodeCommand({ executable: "claude", prompt: "x", sandboxMode: "read-only" });

    expect(command.args[command.args.indexOf("--permission-mode") + 1]).toBe("plan");
  });

  it("forwards any model string verbatim", () => {
    const command = buildClaudeCodeCommand({ executable: "claude", prompt: "x", model: "some-future-model" });

    expect(command.args[command.args.indexOf("--model") + 1]).toBe("some-future-model");
  });

  it("omits the model flag when no model is configured", () => {
    const command = buildClaudeCodeCommand({ executable: "claude", prompt: "x" });

    expect(command.args).not.toContain("--model");
  });

  it("forwards any reasoning effort string verbatim", () => {
    const command = buildClaudeCodeCommand({ executable: "claude", prompt: "x", reasoningEffort: "xhigh" });

    expect(command.args[command.args.indexOf("--effort") + 1]).toBe("xhigh");
  });

  it("ignores a blank reasoning effort", () => {
    const command = buildClaudeCodeCommand({ executable: "claude", prompt: "x", reasoningEffort: "  " });

    expect(command.args).not.toContain("--effort");
  });

  it("passes the profile through the settings payload", () => {
    const command = buildClaudeCodeCommand({ executable: "claude", prompt: "x", profile: "work" });

    const settings = command.args[command.args.indexOf("--settings") + 1]!;
    expect(JSON.parse(settings)).toEqual({ env: { CLAUDE_CODE_PROFILE: "work" } });
  });

  it("emits a single JSON object when a structured result is requested", () => {
    const command = buildClaudeCodeCommand({ executable: "claude", prompt: "x", outputFormat: "json" });

    expect(command.args.slice(0, 3)).toEqual(["-p", "--output-format", "json"]);
    expect(command.args).not.toContain("--verbose");
  });

  it("appends extra system instructions when provided", () => {
    const command = buildClaudeCodeCommand({
      executable: "claude",
      prompt: "x",
      appendSystemPrompt: "Answer in JSON only.",
    });

    expect(command.args[command.args.indexOf("--append-system-prompt") + 1]).toBe("Answer in JSON only.");
  });

  it("replaces the default system prompt when one is supplied", () => {
    const command = buildClaudeCodeCommand({
      executable: "claude",
      prompt: "x",
      systemPrompt: "You name things.",
    });

    expect(command.args[command.args.indexOf("--system-prompt") + 1]).toBe("You name things.");
    expect(command.args).not.toContain("--append-system-prompt");
  });

  it("denies tools so a one-shot completion answers instead of exploring", () => {
    const command = buildClaudeCodeCommand({
      executable: "claude",
      prompt: "x",
      disallowedTools: ["Bash", "Read"],
    });

    expect(command.args[command.args.indexOf("--disallowedTools") + 1]).toBe("Bash");
    expect(command.args[command.args.indexOf("--disallowedTools") + 2]).toBe("Read");
  });

  it("omits the tool denial list when it is empty", () => {
    const command = buildClaudeCodeCommand({ executable: "claude", prompt: "x", disallowedTools: [] });

    expect(command.args).not.toContain("--disallowedTools");
  });
});
