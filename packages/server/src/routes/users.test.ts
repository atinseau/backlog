import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureProjectId, initLayout } from "@backlog/config";
import { Hono } from "hono";
import { describe, expect, it } from "bun:test";
import type { ServerProject } from "../project-context.js";
import type { AppEnv } from "../project-resolver.js";
import { usersRoutes } from "./users.js";

function makeWorkspace(): ServerProject {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-users-route-"));
  initLayout({
    root,
    projectName: "users-route-test",
    repos: [{ id: path.basename(root), path: root, default_branch: "main", enabled: true }],
  });
  const backlogDir = path.join(root, ".backlog");
  return {
    root,
    backlogDir,
    project_id: ensureProjectId(backlogDir),
    resolvedFrom: root,
  };
}

function buildApp(workspace: ServerProject): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("project", workspace);
    await next();
  });
  app.route("/", usersRoutes());
  return app;
}

describe("POST /users/invite", () => {
  it("trims and normalizes email addresses before validation", async () => {
    const app = buildApp(makeWorkspace());
    const res = await app.request("/users/invite", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "  TEST.USER+Backlog@Example.COM  " }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { user: { email: string; display_name: string } };
    expect(body.user.email).toBe("test.user+backlog@example.com");
    expect(body.user.display_name).toBe("test.user+backlog");
  });
});

describe("POST /users", () => {
  it("adds a local active collaborator without an invitation token", async () => {
    const app = buildApp(makeWorkspace());
    const res = await app.request("/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "LOCAL.USER@Example.COM", display_name: "Local User" }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      user: { email: string; display_name: string; status: string; invitation_token?: string };
    };
    expect(body.user.email).toBe("local.user@example.com");
    expect(body.user.display_name).toBe("Local User");
    expect(body.user.status).toBe("active");
    expect(body.user.invitation_token).toBeUndefined();
  });
});
