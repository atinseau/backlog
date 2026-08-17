import { describe, expect, it } from "bun:test";
import { parseCodexStreamLine } from "./stream.js";

function commandStarted(command: string): string {
  return JSON.stringify({ type: "item.started", item: { type: "command_execution", command } });
}

describe("parseCodexStreamLine", () => {
  it("announces the thread when it starts", () => {
    const events = parseCodexStreamLine(JSON.stringify({ type: "thread.started", thread_id: "abcdef123456" }));

    expect(events).toEqual([{ type: "agent.session_init", message: "thread abcdef12" }]);
  });

  it("strips the shell wrapper codex puts around every command", () => {
    expect(parseCodexStreamLine(commandStarted('/bin/zsh -lc "git status"'))).toEqual([
      { type: "agent.git", message: "git status" },
    ]);
  });

  it("classifies reads, edits and test runs apart from plain shell", () => {
    expect(parseCodexStreamLine(commandStarted('/bin/zsh -lc "cat README.md"'))[0]?.type).toBe("agent.read");
    expect(parseCodexStreamLine(commandStarted('/bin/zsh -lc "apply_patch foo"'))[0]?.type).toBe("agent.edit");
    expect(parseCodexStreamLine(commandStarted('/bin/zsh -lc "bun test ./packages"'))[0]?.type).toBe("agent.test");
    expect(parseCodexStreamLine(commandStarted('/bin/zsh -lc "echo hi"'))[0]?.type).toBe("agent.bash");
  });

  it("reports file changes emitted by newer codex versions", () => {
    const line = JSON.stringify({ type: "item.started", item: { type: "file_change", path: "src/app.ts" } });

    expect(parseCodexStreamLine(line)).toEqual([{ type: "agent.edit", message: "Edit src/app.ts" }]);
  });

  it("surfaces a failed shell so a stuck run is visible", () => {
    const line = JSON.stringify({
      type: "item.completed",
      item: { type: "command_execution", status: "failed", exit_code: 2, command: '/bin/zsh -lc "bun run build"' },
    });

    expect(parseCodexStreamLine(line)).toEqual([{ type: "agent.bash_failed", message: "exit 2 — bun run build" }]);
  });

  it("stays silent on a successful completion and on turn lifecycle events", () => {
    const completed = JSON.stringify({
      type: "item.completed",
      item: { type: "command_execution", status: "completed", command: "ls" },
    });

    expect(parseCodexStreamLine(completed)).toEqual([]);
    expect(parseCodexStreamLine(JSON.stringify({ type: "turn.completed" }))).toEqual([]);
  });

  it("ignores log noise codex prints to stdout", () => {
    expect(parseCodexStreamLine("loading config...")).toEqual([]);
  });
});
