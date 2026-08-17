import { describe, expect, it } from "bun:test";
import { applyChatEvent, emptyAssistantTurn, type AssistantTurn } from "./turn.js";

function turn(): AssistantTurn {
  return emptyAssistantTurn();
}

describe("applyChatEvent", () => {
  it("accumulates text deltas in order", () => {
    let current = turn();
    current = applyChatEvent(current, "text", { delta: "Two " });
    current = applyChatEvent(current, "text", { delta: "runs." });

    expect(current.content).toBe("Two runs.");
  });

  it("records a tool call as running", () => {
    const current = applyChatEvent(turn(), "tool_use", { id: "tu_1", name: "list_runs", write: false });

    expect(current.toolCalls).toEqual([
      { id: "tu_1", name: "list_runs", status: "running", write: false, input: undefined },
    ]);
  });

  it("keeps the arguments, which the confirmation card needs to describe the action", () => {
    const current = applyChatEvent(turn(), "tool_use", {
      id: "tu_1",
      name: "start_subtask",
      write: true,
      input: { subtask_id: "subtask_004" },
    });

    expect(current.toolCalls[0]?.input).toEqual({ subtask_id: "subtask_004" });
  });

  it("resolves a call by id, not by name", () => {
    let current = applyChatEvent(turn(), "tool_use", { id: "tu_1", name: "list_runs" });
    current = applyChatEvent(current, "tool_use", { id: "tu_2", name: "list_runs" });
    current = applyChatEvent(current, "tool_result", { id: "tu_2" });

    expect(current.toolCalls.map((call) => call.status)).toEqual(["running", "done"]);
  });

  it("marks a refused call as awaiting confirmation", () => {
    let current = applyChatEvent(turn(), "tool_use", { id: "tu_1", name: "start_orchestrator", write: true });
    current = applyChatEvent(current, "tool_result", { id: "tu_1", awaiting_confirmation: true });

    expect(current.toolCalls[0]?.status).toBe("awaiting_confirmation");
  });

  it("marks a failed call and keeps its message", () => {
    let current = applyChatEvent(turn(), "tool_use", { id: "tu_1", name: "list_runs" });
    current = applyChatEvent(current, "tool_result", { id: "tu_1", error: "disk unreadable" });

    expect(current.toolCalls[0]).toMatchObject({ status: "error", detail: "disk unreadable" });
  });

  it("ignores a result for a call it never saw start", () => {
    const current = applyChatEvent(turn(), "tool_result", { id: "tu_ghost" });

    expect(current.toolCalls).toEqual([]);
  });

  it("captures the session so the next turn can resume it", () => {
    const current = applyChatEvent(turn(), "done", { session_id: "abc-123" });

    expect(current.sessionId).toBe("abc-123");
  });

  it("captures what the turn cost", () => {
    const current = applyChatEvent(turn(), "done", {
      usage: { input_tokens: 4, output_tokens: 120, cache_read_input_tokens: 34000 },
    });

    expect(current.usage).toMatchObject({ input_tokens: 4, output_tokens: 120 });
  });

  it("records an error without discarding the text already streamed", () => {
    let current = applyChatEvent(turn(), "text", { delta: "I was saying" });
    current = applyChatEvent(current, "error", { message: "Not logged in" });

    expect(current.content).toBe("I was saying");
    expect(current.error).toBe("Not logged in");
  });

  it("leaves the turn untouched for an event it does not know", () => {
    const before = turn();
    const after = applyChatEvent(before, "something_new", { x: 1 });

    expect(after).toEqual(before);
  });
});

describe("a turn awaiting confirmation", () => {
  it("exposes the call the user has to decide on", () => {
    let current = applyChatEvent(turn(), "tool_use", {
      id: "tu_1",
      name: "start_orchestrator",
      write: true,
      input: { max_agents: 3 },
    });
    current = applyChatEvent(current, "tool_result", { id: "tu_1", awaiting_confirmation: true });

    const pending = current.toolCalls.find((call) => call.status === "awaiting_confirmation");
    expect(pending?.name).toBe("start_orchestrator");
    expect(pending?.input).toEqual({ max_agents: 3 });
  });
});
