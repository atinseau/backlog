import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";
import { initLayout } from "@backlog/config";
import {
  appendChatMessage,
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  renameConversation,
  setConversationSession,
} from "./chat-store.js";

let backlogDir: string;

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-chat-store-"));
  initLayout({
    root,
    projectName: "chat-store-test",
    repos: [{ id: "backlog", path: root, default_branch: "main", enabled: true }],
  });
  backlogDir = path.join(root, ".backlog");
});

describe("createConversation", () => {
  it("starts an empty conversation with an id and a timestamp", () => {
    const conversation = createConversation(backlogDir);

    expect(conversation.id).toMatch(/^conv_/);
    expect(conversation.messages).toEqual([]);
    expect(conversation.created_at).toBeTruthy();
  });

  it("has no title until one is earned", () => {
    expect(createConversation(backlogDir).title).toBeNull();
  });

  it("accepts a title up front when the caller has one", () => {
    expect(createConversation(backlogDir, { title: "Deploy questions" }).title).toBe("Deploy questions");
  });

  it("gives each conversation its own id", () => {
    const ids = [createConversation(backlogDir).id, createConversation(backlogDir).id];

    expect(new Set(ids).size).toBe(2);
  });
});

describe("listConversations", () => {
  it("is empty on a fresh project", () => {
    expect(listConversations(backlogDir)).toEqual([]);
  });

  it("lists the most recently touched first", () => {
    const older = createConversation(backlogDir, { title: "older" });
    const newer = createConversation(backlogDir, { title: "newer" });
    appendChatMessage(backlogDir, older.id, { role: "user", content: "ping" });

    expect(listConversations(backlogDir).map((item) => item.title)).toEqual(["older", "newer"]);
  });

  it("summarizes without carrying every message", () => {
    const conversation = createConversation(backlogDir);
    appendChatMessage(backlogDir, conversation.id, { role: "user", content: "hello" });

    const summary = listConversations(backlogDir)[0]!;
    expect(summary.message_count).toBe(1);
    expect(summary).not.toHaveProperty("messages");
  });
});

describe("appendChatMessage", () => {
  it("keeps messages in order", () => {
    const conversation = createConversation(backlogDir);
    appendChatMessage(backlogDir, conversation.id, { role: "user", content: "first" });
    appendChatMessage(backlogDir, conversation.id, { role: "assistant", content: "second" });

    expect(getConversation(backlogDir, conversation.id)?.messages.map((m) => m.content)).toEqual([
      "first",
      "second",
    ]);
  });

  it("stamps each message with a time", () => {
    const conversation = createConversation(backlogDir);
    appendChatMessage(backlogDir, conversation.id, { role: "user", content: "hi" });

    expect(getConversation(backlogDir, conversation.id)?.messages[0]?.at).toBeTruthy();
  });

  it("titles the conversation from its first user message", () => {
    const conversation = createConversation(backlogDir);
    appendChatMessage(backlogDir, conversation.id, {
      role: "user",
      content: "Why is subtask_004 blocked on the claims for packages/core?",
    });

    const title = getConversation(backlogDir, conversation.id)?.title ?? "";
    expect(title).toContain("Why is subtask_004 blocked");
    expect(title.length).toBeLessThanOrEqual(60);
  });

  it("does not rewrite a title that already exists", () => {
    const conversation = createConversation(backlogDir, { title: "Chosen name" });
    appendChatMessage(backlogDir, conversation.id, { role: "user", content: "something else entirely" });

    expect(getConversation(backlogDir, conversation.id)?.title).toBe("Chosen name");
  });

  it("carries the tool calls a turn made", () => {
    const conversation = createConversation(backlogDir);
    appendChatMessage(backlogDir, conversation.id, {
      role: "assistant",
      content: "Two runs.",
      tool_calls: [{ id: "tu_1", name: "list_runs", status: "done" }],
    });

    expect(getConversation(backlogDir, conversation.id)?.messages[0]?.tool_calls).toHaveLength(1);
  });

  it("refuses to write into a conversation that does not exist", () => {
    expect(() => appendChatMessage(backlogDir, "conv_nope", { role: "user", content: "x" })).toThrow(
      /conv_nope/,
    );
  });
});

describe("setConversationSession", () => {
  it("remembers the runtime session so a turn can resume it", () => {
    const conversation = createConversation(backlogDir);

    setConversationSession(backlogDir, conversation.id, "abc-123");

    expect(getConversation(backlogDir, conversation.id)?.session_id).toBe("abc-123");
  });

  it("clears it when the conversation is reset", () => {
    const conversation = createConversation(backlogDir);
    setConversationSession(backlogDir, conversation.id, "abc-123");

    setConversationSession(backlogDir, conversation.id, null);

    expect(getConversation(backlogDir, conversation.id)?.session_id).toBeNull();
  });
});

describe("renameConversation", () => {
  it("sets a new title", () => {
    const conversation = createConversation(backlogDir);

    expect(renameConversation(backlogDir, conversation.id, "Release checks").title).toBe("Release checks");
  });

  it("rejects a blank title rather than leaving an unnamed row", () => {
    const conversation = createConversation(backlogDir);

    expect(() => renameConversation(backlogDir, conversation.id, "   ")).toThrow(/title/i);
  });
});

describe("deleteConversation", () => {
  it("removes it from the list", () => {
    const conversation = createConversation(backlogDir);

    deleteConversation(backlogDir, conversation.id);

    expect(listConversations(backlogDir)).toEqual([]);
    expect(getConversation(backlogDir, conversation.id)).toBeNull();
  });

  it("refuses an unknown id", () => {
    expect(() => deleteConversation(backlogDir, "conv_ghost")).toThrow(/conv_ghost/);
  });
});

describe("getConversation", () => {
  it("returns null rather than throwing for an unknown id", () => {
    expect(getConversation(backlogDir, "conv_ghost")).toBeNull();
  });

  it("survives a corrupt file on disk instead of taking the board down", () => {
    const conversation = createConversation(backlogDir);
    fs.writeFileSync(path.join(backlogDir, "chat", `${conversation.id}.json`), "{ not json", "utf8");

    expect(getConversation(backlogDir, conversation.id)).toBeNull();
    expect(listConversations(backlogDir)).toEqual([]);
  });
});
