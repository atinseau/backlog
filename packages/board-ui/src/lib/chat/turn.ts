import type { ChatToolCall, ChatUsage } from "../types.js";

// Folding one turn's SSE events into the shape the transcript displays. Pure,
// so the part that is easy to get wrong — matching results to the call that
// produced them — is testable without a server or a browser.

export interface AssistantTurn {
  content: string;
  toolCalls: ChatToolCall[];
  usage?: ChatUsage;
  sessionId?: string;
  error?: string;
}

export function emptyAssistantTurn(): AssistantTurn {
  return { content: "", toolCalls: [] };
}

type EventData = Record<string, unknown>;

function startCall(turn: AssistantTurn, data: EventData): AssistantTurn {
  const call: ChatToolCall = {
    id: String(data["id"] ?? ""),
    name: String(data["name"] ?? ""),
    status: "running",
    write: data["write"] === true,
    input: data["input"] as Record<string, unknown> | undefined,
  };
  return { ...turn, toolCalls: [...turn.toolCalls, call] };
}

function resolveCall(turn: AssistantTurn, data: EventData): AssistantTurn {
  const id = String(data["id"] ?? "");
  // Matched by id, never by name: a turn can call the same tool twice, and the
  // CLI backend reports results from MCP with the id alone.
  if (!turn.toolCalls.some((call) => call.id === id)) return turn;

  return {
    ...turn,
    toolCalls: turn.toolCalls.map((call) => {
      if (call.id !== id) return call;
      if (data["error"]) return { ...call, status: "error", detail: String(data["error"]) };
      if (data["awaiting_confirmation"] === true) return { ...call, status: "awaiting_confirmation" };
      return { ...call, status: "done" };
    }),
  };
}

/** Apply one event. Unknown types leave the turn exactly as it was. */
export function applyChatEvent(turn: AssistantTurn, type: string, data: EventData): AssistantTurn {
  switch (type) {
    case "text":
      return { ...turn, content: turn.content + String(data["delta"] ?? "") };
    case "tool_use":
      return startCall(turn, data);
    case "tool_result":
      return resolveCall(turn, data);
    case "done": {
      const next = { ...turn };
      if (typeof data["session_id"] === "string" && data["session_id"]) {
        next.sessionId = data["session_id"];
      }
      if (data["usage"] && typeof data["usage"] === "object") {
        next.usage = data["usage"] as ChatUsage;
      }
      return next;
    }
    case "error":
      // The text streamed so far is kept: it is often the most useful part of
      // a turn that ended badly.
      return { ...turn, error: String(data["message"] ?? "unknown error") };
    default:
      return turn;
  }
}

/** The call the user has to decide on, when there is one. */
export function pendingConfirmation(turn: AssistantTurn): ChatToolCall | null {
  return turn.toolCalls.find((call) => call.status === "awaiting_confirmation") ?? null;
}
