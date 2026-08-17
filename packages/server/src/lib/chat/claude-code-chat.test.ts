import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";
import { buildChatCommand, explainChatFailure, parseChatStreamLine } from "./claude-code-chat.js";

function scratchDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "backlog-chat-cli-"));
}

const base = {
  executable: "claude",
  backlogDir: "/tmp/project/.backlog",
  selfCommand: "/usr/local/bin/backlog",
  selfPrefixArgs: [] as string[],
  systemPrompt: "You are the co-pilot.",
  prompt: "what is running?",
};

describe("buildChatCommand", () => {
  it("declares Backlog's own MCP server and nothing else", () => {
    const command = buildChatCommand(base);
    const config = JSON.parse(command.args[command.args.indexOf("--mcp-config") + 1]!) as {
      mcpServers: Record<string, { command: string; args: string[] }>;
    };

    expect(Object.keys(config.mcpServers)).toEqual(["backlog"]);
    expect(config.mcpServers.backlog?.command).toBe("/usr/local/bin/backlog");
    expect(config.mcpServers.backlog?.args).toEqual([
      "mcp-server",
      "--audience",
      "orchestrator",
      "--project",
      "/tmp/project/.backlog",
    ]);
    expect(command.args).toContain("--strict-mcp-config");
  });

  it("re-invokes itself through the prefix args a dev run needs", () => {
    const command = buildChatCommand({ ...base, selfCommand: "/bin/bun", selfPrefixArgs: ["/repo/bin.ts"] });
    const config = JSON.parse(command.args[command.args.indexOf("--mcp-config") + 1]!) as {
      mcpServers: Record<string, { args: string[] }>;
    };

    expect(config.mcpServers.backlog?.args.slice(0, 2)).toEqual(["/repo/bin.ts", "mcp-server"]);
  });

  it("allows every orchestrator tool by its namespaced MCP name", () => {
    const command = buildChatCommand(base);
    const allowed = command.args[command.args.indexOf("--allowedTools") + 1]!.split(",");

    expect(allowed).toContain("mcp__backlog__list_runs");
    expect(allowed).toContain("mcp__backlog__start_subtask");
    expect(allowed).toHaveLength(9);
  });

  it("streams partial messages so the drawer fills in as the model types", () => {
    const command = buildChatCommand(base);

    expect(command.args).toContain("--include-partial-messages");
    expect(command.args[command.args.indexOf("--output-format") + 1]).toBe("stream-json");
  });

  it("puts the user's turn on stdin", () => {
    expect(buildChatCommand(base).stdin).toBe("what is running?");
  });

  it("starts a fresh conversation when there is no session to resume", () => {
    expect(buildChatCommand(base).args).not.toContain("--resume");
  });

  it("resumes an existing conversation when given its id", () => {
    const command = buildChatCommand({ ...base, resumeSessionId: "abc-123" });

    expect(command.args[command.args.indexOf("--resume") + 1]).toBe("abc-123");
  });

  it("lets MCP tools through, which plan mode would have blocked", () => {
    // Observed against the CLI: in plan mode the model is refused its MCP call
    // and works around it with Bash instead.
    const command = buildChatCommand(base);

    expect(command.args[command.args.indexOf("--permission-mode") + 1]).toBe("bypassPermissions");
  });

  it("denies every built-in tool, so the chat cannot touch the checkout", () => {
    // `--allowedTools` only auto-approves; it does not exclude. Without an
    // explicit denial the model reaches for Bash the moment MCP is unhandy —
    // which it did, reading .backlog/tasks.yaml directly.
    const denied = buildChatCommand(base).args[buildChatCommand(base).args.indexOf("--disallowedTools") + 1]!.split(",");

    for (const tool of ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "Task", "WebFetch", "ToolSearch"]) {
      expect(denied).toContain(tool);
    }
  });

  it("does not deny its own MCP tools", () => {
    const command = buildChatCommand(base);
    const denied = command.args[command.args.indexOf("--disallowedTools") + 1]!.split(",");

    expect(denied.filter((tool) => tool.startsWith("mcp__"))).toEqual([]);
  });
});

describe("parseChatStreamLine", () => {
  it("emits text deltas as they arrive", () => {
    const line = JSON.stringify({
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "text_delta", text: "Two runs" } },
    });

    expect(parseChatStreamLine(line)).toEqual([{ type: "text", data: { delta: "Two runs" } }]);
  });

  it("reports a tool call, stripping the MCP namespace from its name", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", id: "tu_1", name: "mcp__backlog__list_runs", input: { a: 1 } }],
      },
    });

    expect(parseChatStreamLine(line)).toEqual([
      { type: "tool_use", data: { id: "tu_1", name: "list_runs", input: { a: 1 }, write: false } },
    ]);
  });

  it("flags a write tool so the UI can mark it", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", id: "tu_2", name: "mcp__backlog__start_subtask", input: {} }] },
    });

    expect(parseChatStreamLine(line)[0]?.data).toMatchObject({ name: "start_subtask", write: true });
  });

  it("reports a tool result, marking a refused one as awaiting confirmation", () => {
    const line = JSON.stringify({
      type: "user",
      message: {
        content: [
          { type: "tool_result", tool_use_id: "tu_2", is_error: true, content: '{"status":"awaiting_confirmation"}' },
        ],
      },
    });

    expect(parseChatStreamLine(line)).toEqual([
      { type: "tool_result", data: { id: "tu_2", awaiting_confirmation: true } },
    ]);
  });

  it("closes the turn with the session id, so the next one can resume", () => {
    const line = JSON.stringify({
      type: "result",
      session_id: "abc-123",
      usage: { input_tokens: 10, output_tokens: 3 },
    });

    expect(parseChatStreamLine(line)).toEqual([
      {
        type: "done",
        data: { session_id: "abc-123", usage: { input_tokens: 10, output_tokens: 3 }, stop_reason: "end_turn" },
      },
    ]);
  });

  it("ignores the assistant's own text blocks, which arrive twice via deltas", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "Two runs are active" }] },
    });

    expect(parseChatStreamLine(line)).toEqual([]);
  });

  it("ignores lines that are not JSON", () => {
    expect(parseChatStreamLine("loading…")).toEqual([]);
  });
});

describe("explainChatFailure", () => {
  it("surfaces the CLI's own message rather than a dump of the stream", () => {
    const stdout = [
      JSON.stringify({ type: "system", subtype: "init", model: "sonnet" }),
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "Not logged in · Please run /login" }] },
        error: "authentication_failed",
      }),
    ].join("\n");

    expect(explainChatFailure(stdout, "")).toBe("Not logged in · Please run /login");
  });

  it("prefers stderr when the CLI wrote one", () => {
    expect(explainChatFailure("", "claude: command failed")).toBe("claude: command failed");
  });

  it("takes the last assistant message, which is the one that failed", () => {
    const stdout = [
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "thinking" }] } }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Credit balance is too low" }] } }),
    ].join("\n");

    expect(explainChatFailure(stdout, "")).toBe("Credit balance is too low");
  });

  it("says something useful even when the stream carried no message at all", () => {
    expect(explainChatFailure("", "")).toMatch(/Claude Code/);
  });

  it("never returns raw JSON to the user", () => {
    const stdout = JSON.stringify({ type: "system", subtype: "init", tools: [] });

    expect(explainChatFailure(stdout, "")).not.toContain("{");
  });
});

describe("the MCP server the chat spawns", () => {
  it("points at the project the chat is bound to", () => {
    const dir = scratchDir();
    const command = buildChatCommand({ ...base, backlogDir: dir });
    const config = JSON.parse(command.args[command.args.indexOf("--mcp-config") + 1]!) as {
      mcpServers: Record<string, { args: string[] }>;
    };

    expect(config.mcpServers.backlog?.args).toContain(dir);
  });
});
