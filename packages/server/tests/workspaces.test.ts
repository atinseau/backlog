import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let server: FastifyInstance;
let dbPath: string;
let token: string;

beforeEach(async () => {
  dbPath = join(
    tmpdir(),
    `backlog-server-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );
  process.env.BACKLOG_SERVER_DB_PATH = dbPath;
  vi.resetModules();
  const { buildServer } = await import("../src/server.js");
  server = await buildServer();
  const signup = await server.inject({
    method: "POST",
    url: "/api/v1/auth/signup",
    payload: { email: "owner@example.com", password: "password123" },
  });
  token = signup.json().token;
});

afterEach(async () => {
  await server.close();
  try {
    unlinkSync(dbPath);
  } catch {
    /* ignore */
  }
});

describe("workspaces", () => {
  it("requires auth", async () => {
    const list = await server.inject({ method: "GET", url: "/api/v1/workspaces" });
    expect(list.statusCode).toBe(401);
  });

  it("creates and lists workspaces, scoped to the owner", async () => {
    const create = await server.inject({
      method: "POST",
      url: "/api/v1/workspaces",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "team-a" },
    });
    expect(create.statusCode).toBe(200);
    const wsId = create.json().workspace.id;

    const list = await server.inject({
      method: "GET",
      url: "/api/v1/workspaces",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(list.json().workspaces).toHaveLength(1);

    // another user shouldn't see it
    const other = await server.inject({
      method: "POST",
      url: "/api/v1/auth/signup",
      payload: { email: "other@example.com", password: "password123" },
    });
    const otherToken = other.json().token;
    const otherList = await server.inject({
      method: "GET",
      url: "/api/v1/workspaces",
      headers: { authorization: `Bearer ${otherToken}` },
    });
    expect(otherList.json().workspaces).toHaveLength(0);

    // and shouldn't be able to read the other user's workspace by id
    const peek = await server.inject({
      method: "GET",
      url: `/api/v1/workspaces/${wsId}`,
      headers: { authorization: `Bearer ${otherToken}` },
    });
    expect(peek.statusCode).toBe(404);
  });

  it("attaches work items to a workspace", async () => {
    const ws = await server.inject({
      method: "POST",
      url: "/api/v1/workspaces",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "ws" },
    });
    const wsId = ws.json().workspace.id;

    const item = await server.inject({
      method: "POST",
      url: `/api/v1/workspaces/${wsId}/work-items`,
      headers: { authorization: `Bearer ${token}` },
      payload: { external_id: "WI-1", title: "do thing", priority: "P1" },
    });
    expect(item.statusCode).toBe(200);
    expect(item.json().work_item.priority).toBe("P1");

    const list = await server.inject({
      method: "GET",
      url: `/api/v1/workspaces/${wsId}/work-items`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(list.json().work_items).toHaveLength(1);
  });
});
