import { describe, expect, it } from "bun:test";
import { buildClaudeCodeCommand } from "./command.js";

describe("buildClaudeCodeCommand", () => {
  it("streams NDJSON", () => {
    const command = buildClaudeCodeCommand({ executable: "claude", prompt: "do the thing" });

    expect(command.executable).toBe("claude");
    expect(command.args.slice(0, 4)).toEqual(["-p", "--output-format", "stream-json", "--verbose"]);
  });

  it("feeds the prompt on stdin, never as an argument", () => {
    // Two reasons. `--disallowedTools <tools...>` is variadic and swallows any
    // following positional, so a prompt in argv is eaten and the CLI exits
    // with "Input must be provided…". And an argv prompt leaks the whole task
    // description into `ps` output.
    const command = buildClaudeCodeCommand({ executable: "claude", prompt: "do the thing" });

    expect(command.stdin).toBe("do the thing");
    expect(command.args).not.toContain("do the thing");
  });

  it("always runs under bypassPermissions — there is one run shape", () => {
    const command = buildClaudeCodeCommand({ executable: "claude", prompt: "x" });
    expect(command.args).toContain("--permission-mode");
    expect(command.args[command.args.indexOf("--permission-mode") + 1]).toBe("bypassPermissions");
    expect(command.args).not.toContain("plan");
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

  it("carries a profile and a Stop hook in one --settings payload", () => {
    const command = buildClaudeCodeCommand({
      executable: "claude",
      prompt: "x",
      profile: "work",
      stopHookCommand: "/tmp/project/.backlog/bin/stop-hook",
    });

    const settings = JSON.parse(command.args[command.args.indexOf("--settings") + 1] ?? "{}");
    expect(settings.env).toEqual({ CLAUDE_CODE_PROFILE: "work" });
    expect(settings.hooks).toEqual({
      Stop: [{ hooks: [{ type: "command", command: "/tmp/project/.backlog/bin/stop-hook" }] }],
    });
  });

  it("emits no --settings when there is neither a profile nor a hook", () => {
    const command = buildClaudeCodeCommand({ executable: "claude", prompt: "x" });

    expect(command.args).not.toContain("--settings");
  });

  it("carries the Stop hook alone, with no env key, when there is no profile", () => {
    const command = buildClaudeCodeCommand({
      executable: "claude",
      prompt: "x",
      stopHookCommand: "/tmp/project/.backlog/bin/stop-hook",
    });

    const settings = JSON.parse(command.args[command.args.indexOf("--settings") + 1] ?? "{}");
    expect(settings.hooks).toEqual({
      Stop: [{ hooks: [{ type: "command", command: "/tmp/project/.backlog/bin/stop-hook" }] }],
    });
    expect(settings.env).toBeUndefined();
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

    expect(command.args[command.args.indexOf("--disallowedTools") + 1]).toBe("Bash,Read");
  });

  it("collapses the tool list into one comma-separated argument", () => {
    const command = buildClaudeCodeCommand({
      executable: "claude",
      prompt: "the prompt",
      disallowedTools: ["Bash", "Read", "Write"],
    });

    expect(command.args[command.args.indexOf("--disallowedTools") + 1]).toBe("Bash,Read,Write");
    expect(command.args.filter((arg) => arg === "Bash")).toEqual([]);
  });

  it("omits the tool denial list when it is empty", () => {
    const command = buildClaudeCodeCommand({ executable: "claude", prompt: "x", disallowedTools: [] });

    expect(command.args).not.toContain("--disallowedTools");
  });

  it("keeps --strict-mcp-config by default, so the chat is unaffected", () => {
    const command = buildClaudeCodeCommand({
      executable: "claude",
      prompt: "hi",
      mcpServers: { backlog: { command: "/usr/local/bin/backlog", args: ["mcp-server"] } },
    });

    expect(command.args).toContain("--strict-mcp-config");
  });

  // A completion declares no MCP server of its own. Before this, that meant
  // neither flag was emitted and the CLI loaded every server the user had
  // configured into a call whose only job is to name a ticket.
  it("hides the user's MCP servers from a call that declares none of its own", () => {
    const command = buildClaudeCodeCommand({ executable: "claude", prompt: "name this", outputFormat: "json" });

    expect(command.args).toContain("--strict-mcp-config");
    expect(command.args).not.toContain("--mcp-config");
  });

  it("leaves a run's own MCP servers in place when strictness is waived", () => {
    const command = buildClaudeCodeCommand({
      executable: "claude",
      prompt: "hi",
      mcpServers: { backlog: { command: "/usr/local/bin/backlog", args: ["mcp-server"] } },
      strictMcpConfig: false,
    });

    expect(command.args).toContain("--mcp-config");
    expect(command.args).not.toContain("--strict-mcp-config");
  });
});
