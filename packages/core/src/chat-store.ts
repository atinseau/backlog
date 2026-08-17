import fs from "node:fs";
import path from "node:path";
import { nextId } from "@backlog/config";
import {
  chatMessageSchema,
  conversationSchema,
  type Conversation,
  type ConversationSummary,
  type NewChatMessageInput,
} from "@backlog/schemas";

// Conversations on disk, one JSON file each under `.backlog/chat/`. Deliberately
// not the CLI's own `~/.claude/projects/*.jsonl`: those only exist for the CLI
// backend and their shape is internal. Here a conversation reads the same
// whichever runtime answered, and the runtime's session id is just one field.

const MAX_TITLE_LENGTH = 60;

// `updated_at` is what orders the conversation list, and Date has only
// millisecond resolution — two writes in the same tick would tie and the list
// would flicker between orders. Forcing strict monotonicity costs nothing and
// makes "most recently touched" mean exactly that.
let lastStampMs = 0;

function nextTimestamp(): string {
  lastStampMs = Math.max(Date.now(), lastStampMs + 1);
  return new Date(lastStampMs).toISOString();
}

function chatDir(backlogDir: string): string {
  return path.join(backlogDir, "chat");
}

function conversationPath(backlogDir: string, id: string): string {
  return path.join(chatDir(backlogDir), `${id}.json`);
}

function write(backlogDir: string, conversation: Conversation): Conversation {
  const parsed = conversationSchema.parse({ ...conversation, updated_at: nextTimestamp() });
  fs.mkdirSync(chatDir(backlogDir), { recursive: true });
  fs.writeFileSync(conversationPath(backlogDir, parsed.id), `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  return parsed;
}

/** @returns null for an unknown id, and for a file too damaged to parse. */
export function getConversation(backlogDir: string, id: string): Conversation | null {
  const file = conversationPath(backlogDir, id);
  if (!fs.existsSync(file)) return null;
  try {
    return conversationSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    // A corrupt transcript must not take the board down with it.
    return null;
  }
}

function requireConversation(backlogDir: string, id: string): Conversation {
  const conversation = getConversation(backlogDir, id);
  if (!conversation) {
    throw new Error(`Unknown conversation: ${id}`);
  }
  return conversation;
}

export interface CreateConversationInput {
  title?: string | undefined;
  model?: string | undefined;
}

export function createConversation(backlogDir: string, input: CreateConversationInput = {}): Conversation {
  const now = nextTimestamp();
  return write(backlogDir, {
    version: 1,
    id: nextId(backlogDir, "conv"),
    title: input.title?.trim() || null,
    created_at: now,
    updated_at: now,
    session_id: null,
    backend: null,
    model: input.model ?? null,
    messages: [],
  });
}

/** Most recently touched first — the order a conversation list wants. */
export function listConversations(backlogDir: string): ConversationSummary[] {
  const dir = chatDir(backlogDir);
  if (!fs.existsSync(dir)) return [];

  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => getConversation(backlogDir, name.slice(0, -".json".length)))
    .filter((conversation): conversation is Conversation => conversation !== null)
    .map(({ messages, ...summary }) => ({ ...summary, message_count: messages.length }))
    .sort((left, right) => {
      // Two conversations created in the same millisecond share a timestamp,
      // so the id breaks the tie and the order stays deterministic.
      const byTime = right.updated_at.localeCompare(left.updated_at);
      return byTime !== 0 ? byTime : right.id.localeCompare(left.id, undefined, { numeric: true });
    });
}

/** The first thing the user asked, trimmed to fit a list row. */
function titleFrom(content: string): string {
  const line = content.trim().split("\n")[0]?.trim() ?? "";
  if (line.length <= MAX_TITLE_LENGTH) return line;
  return `${line.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`;
}

export type NewChatMessage = Omit<NewChatMessageInput, "at"> & { at?: string };

export function appendChatMessage(backlogDir: string, id: string, message: NewChatMessage): Conversation {
  const conversation = requireConversation(backlogDir, id);
  const stamped = chatMessageSchema.parse({ at: nextTimestamp(), ...message });

  // A conversation earns its name from the first thing asked of it, and keeps
  // it: a later rename is the user's decision, not ours.
  const title =
    conversation.title ?? (stamped.role === "user" ? titleFrom(stamped.content) || null : null);

  return write(backlogDir, {
    ...conversation,
    title,
    messages: [...conversation.messages, stamped],
  });
}

/** Record — or clear — the runtime session a resume would continue. */
export function setConversationSession(
  backlogDir: string,
  id: string,
  sessionId: string | null,
): Conversation {
  return write(backlogDir, { ...requireConversation(backlogDir, id), session_id: sessionId });
}

export function setConversationBackend(
  backlogDir: string,
  id: string,
  backend: string,
  model: string | null,
): Conversation {
  return write(backlogDir, { ...requireConversation(backlogDir, id), backend, model });
}

/**
 * Cut the transcript back to its first `keep` messages — what an edit or a
 * regeneration needs.
 *
 * The runtime session goes with it. A Claude Code session cannot be rewound:
 * keeping it would leave the discarded turns alive in the model's context
 * behind a transcript that no longer shows them, which is the worst of both.
 * The next turn therefore starts fresh and pays for a new context.
 */
export function truncateConversation(backlogDir: string, id: string, keep: number): Conversation {
  if (!Number.isInteger(keep) || keep < 0) {
    throw new Error(`Invalid message count: ${keep}`);
  }
  const conversation = requireConversation(backlogDir, id);
  return write(backlogDir, {
    ...conversation,
    messages: conversation.messages.slice(0, keep),
    session_id: null,
  });
}

/**
 * Pin a model for this conversation, or clear it back to the project default.
 * Also resets the session: a runtime cannot swap model mid-thread, so the
 * choice only takes effect on a fresh context.
 */
export function setConversationModel(backlogDir: string, id: string, model: string | null): Conversation {
  return write(backlogDir, { ...requireConversation(backlogDir, id), model, session_id: null });
}

/** Title and transcript search. A blank query returns everything. */
export function searchConversations(backlogDir: string, query: string): ConversationSummary[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return listConversations(backlogDir);

  return listConversations(backlogDir).filter((summary) => {
    if ((summary.title ?? "").toLowerCase().includes(needle)) return true;
    const conversation = getConversation(backlogDir, summary.id);
    return (conversation?.messages ?? []).some((message) =>
      message.content.toLowerCase().includes(needle),
    );
  });
}

export function renameConversation(backlogDir: string, id: string, title: string): Conversation {
  const trimmed = title.trim();
  if (!trimmed) {
    throw new Error("A conversation title cannot be blank.");
  }
  return write(backlogDir, { ...requireConversation(backlogDir, id), title: trimmed });
}

export function deleteConversation(backlogDir: string, id: string): void {
  requireConversation(backlogDir, id);
  fs.rmSync(conversationPath(backlogDir, id));
}
