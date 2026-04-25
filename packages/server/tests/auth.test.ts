import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let server: FastifyInstance;
let dbPath: string;

beforeEach(async () => {
  dbPath = join(
    tmpdir(),
    `backlog-server-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );
  process.env.BACKLOG_SERVER_DB_PATH = dbPath;
  vi.resetModules();
  const { buildServer } = await import("../src/server.js");
  server = await buildServer();
});

afterEach(async () => {
  await server.close();
  try {
    unlinkSync(dbPath);
  } catch {
    /* ignore */
  }
});

describe("auth API", () => {
  it("signs up, returns token + user, blocks duplicates", async () => {
    const signup = await server.inject({
      method: "POST",
      url: "/api/v1/auth/signup",
      payload: { email: "alice@example.com", password: "password123" },
    });
    expect(signup.statusCode).toBe(200);
    const body = signup.json();
    expect(body.user.email).toBe("alice@example.com");
    expect(body.token).toBeTruthy();
    expect(body.expires_at).toBeTruthy();

    const dup = await server.inject({
      method: "POST",
      url: "/api/v1/auth/signup",
      payload: { email: "alice@example.com", password: "password123" },
    });
    expect(dup.statusCode).toBe(409);
  });

  it("logs in with the right password and rejects the wrong one", async () => {
    await server.inject({
      method: "POST",
      url: "/api/v1/auth/signup",
      payload: { email: "bob@example.com", password: "password123" },
    });

    const ok = await server.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "bob@example.com", password: "password123" },
    });
    expect(ok.statusCode).toBe(200);

    const ko = await server.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "bob@example.com", password: "wrongpassword" },
    });
    expect(ko.statusCode).toBe(401);
  });

  it("returns 401 on /me without token, 200 with valid token", async () => {
    const signup = await server.inject({
      method: "POST",
      url: "/api/v1/auth/signup",
      payload: { email: "carol@example.com", password: "password123" },
    });
    const token = signup.json().token;

    expect((await server.inject({ method: "GET", url: "/api/v1/auth/me" })).statusCode).toBe(401);

    const withAuth = await server.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(withAuth.statusCode).toBe(200);
    expect(withAuth.json().user.email).toBe("carol@example.com");
  });

  it("invalidates token after logout", async () => {
    const signup = await server.inject({
      method: "POST",
      url: "/api/v1/auth/signup",
      payload: { email: "dave@example.com", password: "password123" },
    });
    const token = signup.json().token;

    const logout = await server.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(logout.statusCode).toBe(204);

    const meAfter = await server.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(meAfter.statusCode).toBe(401);
  });
});
