import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";
import { ensureProjectId, initLayout } from "@backlog/config";
import { Hono } from "hono";
import type { Conversation, ConversationSummary } from "@backlog/schemas";
import type { ServerProject } from "../project-context.js";
import type { AppEnv } from "../project-resolver.js";
import { conversationsRoutes } from "./conversations.js";

let app: Hono<AppEnv>;
let backlogDir: string;

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-conversations-rewind-"));
  initLayout({
    root,
    projectName: "conversations-rewind-test",
    repos: [{ id: "backlog", path: root, default_branch: "main", enabled: true }],
  });
  backlogDir = path.join(root, ".backlog");
  const workspace: ServerProject = {
    root,
    backlogDir,
    project_id: ensureProjectId(backlogDir),
    resolvedFrom: root,
  };

  app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("project", workspace);
    await next();
  });
  app.route("/", conversationsRoutes());
});

async function seeded(): Promise<Conversation> {
  const created = await app.request("/conversations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  const conversation = ((await created.json()) as { conversation: Conversation }).conversation;
  const { appendChatMessage: append } = await import("@backlog/core");
  append(backlogDir, conversation.id, { role: "user", content: "first question" });
  append(backlogDir, conversation.id, { role: "assistant", content: "first answer" });
  append(backlogDir, conversation.id, { role: "user", content: "second question" });
  append(backlogDir, conversation.id, { role: "assistant", content: "second answer" });
  return conversation;
}

async function read(id: string): Promise<Conversation> {
  const res = await app.request(`/conversations/${id}`);
  return ((await res.json()) as { conversation: Conversation }).conversation;
}

describe("POST /conversations/:id/truncate", () => {
  it("cuts the transcript back to the requested length", async () => {
    const conversation = await seeded();

    const res = await app.request(`/conversations/${conversation.id}/truncate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ keep: 2 }),
    });

    expect(res.status).toBe(200);
    expect((await read(conversation.id)).messages).toHaveLength(2);
  });

  it("404s on an unknown conversation", async () => {
    const res = await app.request("/conversations/conv_ghost/truncate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ keep: 0 }),
    });

    expect(res.status).toBe(404);
  });

  it("rejects a negative length", async () => {
    const conversation = await seeded();

    const res = await app.request(`/conversations/${conversation.id}/truncate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ keep: -2 }),
    });

    expect(res.status).toBe(400);
  });
});

describe("PATCH /conversations/:id with a model", () => {
  it("pins the model", async () => {
    const conversation = await seeded();

    const res = await app.request(`/conversations/${conversation.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "opus" }),
    });

    expect(res.status).toBe(200);
    expect(((await res.json()) as { conversation: Conversation }).conversation.model).toBe("opus");
  });

  it("clears it with an explicit null", async () => {
    const conversation = await seeded();
    await app.request(`/conversations/${conversation.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "opus" }),
    });

    const res = await app.request(`/conversations/${conversation.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: null }),
    });

    expect(((await res.json()) as { conversation: Conversation }).conversation.model).toBeNull();
  });
});

describe("GET /conversations?q=", () => {
  it("filters on the transcript, not just the title", async () => {
    const conversation = await seeded();
    const other = await app.request("/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Unrelated" }),
    });
    void other;

    const res = await app.request("/conversations?q=second%20question");
    const body = (await res.json()) as { conversations: ConversationSummary[] };

    expect(body.conversations.map((item) => item.id)).toEqual([conversation.id]);
  });

  it("returns everything without a query", async () => {
    await seeded();
    await seeded();

    const res = await app.request("/conversations");

    expect(((await res.json()) as { conversations: ConversationSummary[] }).conversations).toHaveLength(2);
  });
});
