import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";
import { ensureProjectId, initLayout } from "@backlog/config";
import type { Conversation, ConversationSummary } from "@backlog/schemas";
import { Hono } from "hono";
import type { ServerProject } from "../project-context.js";
import type { AppEnv } from "../project-resolver.js";
import { conversationsRoutes } from "./conversations.js";

let app: Hono<AppEnv>;

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-conversations-route-"));
  initLayout({
    root,
    projectName: "conversations-route-test",
    repos: [{ id: "backlog", path: root, default_branch: "main", enabled: true }],
  });
  const backlogDir = path.join(root, ".backlog");
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

async function create(body: Record<string, unknown> = {}): Promise<Conversation> {
  const res = await app.request("/conversations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return ((await res.json()) as { conversation: Conversation }).conversation;
}

async function list(): Promise<ConversationSummary[]> {
  const res = await app.request("/conversations");
  return ((await res.json()) as { conversations: ConversationSummary[] }).conversations;
}

describe("POST /conversations", () => {
  it("creates an empty conversation", async () => {
    const res = await app.request("/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(201);
    const conversation = ((await res.json()) as { conversation: Conversation }).conversation;
    expect(conversation.id).toMatch(/^conv_/);
    expect(conversation.messages).toEqual([]);
  });

  it("accepts a title", async () => {
    expect((await create({ title: "Release checks" })).title).toBe("Release checks");
  });
});

describe("GET /conversations", () => {
  it("is empty on a fresh project", async () => {
    expect(await list()).toEqual([]);
  });

  it("lists what was created, newest first", async () => {
    await create({ title: "first" });
    await create({ title: "second" });

    expect((await list()).map((item) => item.title)).toEqual(["second", "first"]);
  });

  it("does not ship every transcript in the list", async () => {
    await create();

    expect(await list()).not.toHaveProperty("0.messages");
  });
});

describe("GET /conversations/:id", () => {
  it("returns the full transcript", async () => {
    const created = await create({ title: "Deep dive" });

    const res = await app.request(`/conversations/${created.id}`);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { conversation: Conversation };
    expect(body.conversation.title).toBe("Deep dive");
    expect(body.conversation.messages).toEqual([]);
  });

  it("404s on an unknown id", async () => {
    expect((await app.request("/conversations/conv_ghost")).status).toBe(404);
  });
});

describe("PATCH /conversations/:id", () => {
  it("renames", async () => {
    const created = await create();

    const res = await app.request(`/conversations/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Renamed" }),
    });

    expect(res.status).toBe(200);
    expect(((await res.json()) as { conversation: Conversation }).conversation.title).toBe("Renamed");
  });

  it("rejects a blank title", async () => {
    const created = await create();

    const res = await app.request(`/conversations/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "   " }),
    });

    expect(res.status).toBe(400);
  });

  it("clears the session, which is how a conversation is reset without losing it", async () => {
    const created = await create();

    const res = await app.request(`/conversations/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session_id: null }),
    });

    expect(res.status).toBe(200);
    expect(((await res.json()) as { conversation: Conversation }).conversation.session_id).toBeNull();
  });
});

describe("DELETE /conversations/:id", () => {
  it("removes it", async () => {
    const created = await create();

    expect((await app.request(`/conversations/${created.id}`, { method: "DELETE" })).status).toBe(204);
    expect(await list()).toEqual([]);
  });

  it("404s on an unknown id", async () => {
    expect((await app.request("/conversations/conv_ghost", { method: "DELETE" })).status).toBe(404);
  });
});

describe("POST /conversations/:id/messages", () => {
  it("404s on an unknown conversation before spending anything", async () => {
    const res = await app.request("/conversations/conv_ghost/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "hello" }),
    });

    expect(res.status).toBe(404);
  });

  it("rejects an empty message", async () => {
    const created = await create();

    const res = await app.request(`/conversations/${created.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "   " }),
    });

    expect(res.status).toBe(400);
  });

  it("records the user's turn even when no runtime can answer", async () => {
    // No API key and, in CI, no `claude` binary: the send fails, but what the
    // user typed must not vanish with it.
    const created = await create();

    await app.request(`/conversations/${created.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({ content: "what is running?" }),
    });

    const res = await app.request(`/conversations/${created.id}`);
    const body = (await res.json()) as { conversation: Conversation };
    expect(body.conversation.messages[0]).toMatchObject({ role: "user", content: "what is running?" });
  });
});
