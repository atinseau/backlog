import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";
import { initLayout } from "@backlog/config";
import {
  appendChatMessage,
  createConversation,
  getConversation,
  searchConversations,
  setConversationModel,
  truncateConversation,
} from "./chat-store.js";

let backlogDir: string;

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-chat-rewind-"));
  initLayout({
    root,
    projectName: "chat-rewind-test",
    repos: [{ id: "backlog", path: root, default_branch: "main", enabled: true }],
  });
  backlogDir = path.join(root, ".backlog");
});

function withTurns(count: number): string {
  const conversation = createConversation(backlogDir);
  for (let index = 0; index < count; index++) {
    appendChatMessage(backlogDir, conversation.id, { role: "user", content: `ask ${index}` });
    appendChatMessage(backlogDir, conversation.id, { role: "assistant", content: `answer ${index}` });
  }
  return conversation.id;
}

describe("truncateConversation", () => {
  it("keeps the first N messages and drops the rest", () => {
    const id = withTurns(3);

    const conversation = truncateConversation(backlogDir, id, 3);

    expect(conversation.messages.map((message) => message.content)).toEqual([
      "ask 0",
      "answer 0",
      "ask 1",
    ]);
  });

  it("forgets the runtime session, because a CLI session cannot be rewound", () => {
    // The transcript is ours to cut; the runtime's context is not. Keeping the
    // session would leave the discarded turns alive behind a transcript that no
    // longer shows them.
    const id = withTurns(2);
    const { setConversationSession } = require("./chat-store.js") as typeof import("./chat-store.js");
    setConversationSession(backlogDir, id, "abc-123");

    expect(truncateConversation(backlogDir, id, 1).session_id).toBeNull();
  });

  it("keeping everything is a no-op that still clears the session", () => {
    const id = withTurns(1);

    expect(truncateConversation(backlogDir, id, 2).messages).toHaveLength(2);
  });

  it("rejects a negative count", () => {
    const id = withTurns(1);

    expect(() => truncateConversation(backlogDir, id, -1)).toThrow(/count/i);
  });

  it("can empty a conversation entirely", () => {
    const id = withTurns(2);

    expect(truncateConversation(backlogDir, id, 0).messages).toEqual([]);
  });

  it("refuses an unknown conversation", () => {
    expect(() => truncateConversation(backlogDir, "conv_ghost", 0)).toThrow(/conv_ghost/);
  });
});

describe("setConversationModel", () => {
  it("pins a model for the whole conversation", () => {
    const id = withTurns(0);

    expect(setConversationModel(backlogDir, id, "opus").model).toBe("opus");
  });

  it("clears it back to the project default", () => {
    const id = withTurns(0);
    setConversationModel(backlogDir, id, "opus");

    expect(setConversationModel(backlogDir, id, null).model).toBeNull();
  });

  it("resets the session, since the runtime cannot switch model mid-thread", () => {
    const id = withTurns(1);
    const { setConversationSession } = require("./chat-store.js") as typeof import("./chat-store.js");
    setConversationSession(backlogDir, id, "abc-123");

    expect(setConversationModel(backlogDir, id, "opus").session_id).toBeNull();
  });
});

describe("searchConversations", () => {
  it("returns everything for a blank query", () => {
    withTurns(1);
    withTurns(1);

    expect(searchConversations(backlogDir, "  ")).toHaveLength(2);
  });

  it("matches on the title", () => {
    const id = createConversation(backlogDir, { title: "Release checks" }).id;
    createConversation(backlogDir, { title: "Something else" });

    expect(searchConversations(backlogDir, "release").map((item) => item.id)).toEqual([id]);
  });

  it("matches on message content, which is where the answer usually is", () => {
    const id = createConversation(backlogDir, { title: "Untitled thread" }).id;
    appendChatMessage(backlogDir, id, { role: "assistant", content: "subtask_004 is blocked on a claim" });
    createConversation(backlogDir, { title: "Other" });

    expect(searchConversations(backlogDir, "subtask_004").map((item) => item.id)).toEqual([id]);
  });

  it("ignores case", () => {
    createConversation(backlogDir, { title: "Release Checks" });

    expect(searchConversations(backlogDir, "RELEASE")).toHaveLength(1);
  });

  it("returns nothing when nothing matches", () => {
    createConversation(backlogDir, { title: "Release checks" });

    expect(searchConversations(backlogDir, "kubernetes")).toEqual([]);
  });

  it("still summarises, without shipping the transcripts it searched", () => {
    const id = createConversation(backlogDir, { title: "Deep" }).id;
    appendChatMessage(backlogDir, id, { role: "user", content: "hello" });

    const [found] = searchConversations(backlogDir, "deep");
    expect(found?.message_count).toBe(1);
    expect(found).not.toHaveProperty("messages");
  });
});

describe("a conversation that was rewound", () => {
  it("can be continued from where it was cut", () => {
    const id = withTurns(2);
    truncateConversation(backlogDir, id, 2);

    appendChatMessage(backlogDir, id, { role: "user", content: "different question" });

    expect(getConversation(backlogDir, id)?.messages.map((message) => message.content)).toEqual([
      "ask 0",
      "answer 0",
      "different question",
    ]);
  });
});
