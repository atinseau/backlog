import {
  apiUrl,
  createConversation as createConversationApi,
  deleteConversation as deleteConversationApi,
  fetchChatStatus,
  fetchConversation,
  fetchConversations,
  patchConversation,
  type ChatBackendStatus,
  type ChatTranscriptMessage,
  type Conversation,
  type ConversationSummary,
} from "../api.js";
import { applyChatEvent, emptyAssistantTurn, type AssistantTurn } from "./turn.js";

// All of the chat's state in one place: which conversations exist, which one is
// open, and the turn currently streaming into it. The components read from
// here; none of them talks to the network.

let conversations = $state<ConversationSummary[]>([]);
let current = $state<Conversation | null>(null);
let streaming = $state<AssistantTurn | null>(null);
let status = $state<ChatBackendStatus | null>(null);
let loading = $state(false);
let error = $state<string | null>(null);
let inFlight: AbortController | null = null;

export function chatConversations(): ConversationSummary[] {
  return conversations;
}
export function currentConversation(): Conversation | null {
  return current;
}
/** The turn being streamed right now, or null between turns. */
export function streamingTurn(): AssistantTurn | null {
  return streaming;
}
export function chatStatus(): ChatBackendStatus | null {
  return status;
}
export function chatLoading(): boolean {
  return loading;
}
export function chatError(): string | null {
  return error;
}
export function isSending(): boolean {
  return inFlight !== null;
}

/** The transcript plus whatever is streaming, which is what the view renders. */
export function visibleMessages(): ChatTranscriptMessage[] {
  const persisted = current?.messages ?? [];
  if (!streaming) return persisted;
  return [
    ...persisted,
    {
      role: "assistant",
      content: streaming.content,
      at: new Date().toISOString(),
      tool_calls: streaming.toolCalls,
      ...(streaming.usage ? { usage: streaming.usage } : {}),
      ...(streaming.error ? { error: streaming.error } : {}),
    },
  ];
}

function fail(err: unknown): void {
  error = err instanceof Error ? err.message : String(err);
}

export async function loadChat(): Promise<void> {
  loading = true;
  try {
    [conversations, status] = await Promise.all([fetchConversations(), fetchChatStatus()]);
    error = null;
    // Reopen the most recent thread, so returning to the board resumes where
    // the user left off instead of facing an empty drawer.
    if (!current && conversations[0]) {
      await openConversation(conversations[0].id);
    }
  } catch (err) {
    fail(err);
  } finally {
    loading = false;
  }
}

export async function openConversation(id: string): Promise<void> {
  try {
    current = await fetchConversation(id);
    streaming = null;
    error = null;
  } catch (err) {
    fail(err);
  }
}

export async function startConversation(): Promise<void> {
  try {
    current = await createConversationApi();
    streaming = null;
    error = null;
    conversations = await fetchConversations();
  } catch (err) {
    fail(err);
  }
}

export async function removeConversation(id: string): Promise<void> {
  try {
    await deleteConversationApi(id);
    if (current?.id === id) current = null;
    conversations = await fetchConversations();
    if (!current && conversations[0]) await openConversation(conversations[0].id);
  } catch (err) {
    fail(err);
  }
}

export async function renameCurrent(title: string): Promise<void> {
  if (!current) return;
  try {
    current = await patchConversation(current.id, { title });
    conversations = await fetchConversations();
  } catch (err) {
    fail(err);
  }
}

/**
 * Forget the runtime session while keeping the transcript. This is what `/clear`
 * means here: the next turn starts a fresh context, and the history above stays
 * readable.
 */
export async function resetContext(): Promise<void> {
  if (!current) return;
  try {
    current = await patchConversation(current.id, { session_id: null });
  } catch (err) {
    fail(err);
  }
}

/** Abort the turn in flight. The server still records what arrived. */
export function stopStreaming(): void {
  inFlight?.abort();
  inFlight = null;
}

function parseSseBlock(block: string): { event: string; data: Record<string, unknown> } | null {
  let event = "message";
  let raw = "";
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) raw += line.slice(5).trim();
  }
  if (!raw) return null;
  try {
    return { event, data: JSON.parse(raw) as Record<string, unknown> };
  } catch {
    return null;
  }
}

export async function sendMessage(content: string): Promise<void> {
  const text = content.trim();
  if (!text || inFlight) return;
  if (!current) await startConversation();
  const conversation = current;
  if (!conversation) return;

  error = null;
  streaming = emptyAssistantTurn();
  const controller = new AbortController();
  inFlight = controller;

  // Show the user's turn immediately; the server has persisted it by the time
  // the first event arrives.
  current = {
    ...conversation,
    messages: [
      ...conversation.messages,
      { role: "user", content: text, at: new Date().toISOString(), tool_calls: [] },
    ],
  };

  try {
    const response = await fetch(apiUrl(`/conversations/${encodeURIComponent(conversation.id)}/messages`), {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({ content: text }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = (await response.json().catch(() => ({}))) as { detail?: string };
      throw new Error(detail.detail ?? `HTTP ${response.status}`);
    }
    if (!response.body) throw new Error("Stream body missing");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const parsed = parseSseBlock(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        if (parsed && streaming) {
          streaming = applyChatEvent(streaming, parsed.event, parsed.data);
        }
        boundary = buffer.indexOf("\n\n");
      }
    }
  } catch (err) {
    if ((err as Error).name !== "AbortError") fail(err);
  } finally {
    inFlight = null;
    streaming = null;
    // Re-read from the server: it owns the transcript, including the turn we
    // just streamed and the session id to resume next time.
    await openConversation(conversation.id);
    conversations = await fetchConversations().catch(() => conversations);
  }
}
