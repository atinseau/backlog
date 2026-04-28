import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureProjectId, initLayout } from "@backlog/config";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { ServerProject } from "../project-context.js";
import type { AppEnv } from "../project-resolver.js";
import { orchestrateRoutes } from "./orchestrate.js";

function makeWorkspace(): ServerProject {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-orch-route-"));
  initLayout({
    root,
    projectName: "orch-route-test",
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
    c.set("workspace", workspace);
    await next();
  });
  app.route("/", orchestrateRoutes());
  return app;
}

describe("GET /orchestrate", () => {
  it("returns an empty plan for a fresh workspace", async () => {
    const app = buildApp(makeWorkspace());
    const res = await app.request("/orchestrate");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      generated_at: string;
      workspace: string;
      max_agents: number;
      runnable_count: number;
      waves: unknown[];
      waiting: unknown[];
      blocked: unknown[];
      skipped: unknown[];
    };
    expect(body.runnable_count).toBe(0);
    expect(body.waves).toEqual([]);
    expect(body.waiting).toEqual([]);
    expect(body.blocked).toEqual([]);
    expect(body.skipped).toEqual([]);
    expect(typeof body.generated_at).toBe("string");
    expect(body.max_agents).toBeGreaterThan(0);
  });

  it("accepts a ?work_item= filter without crashing", async () => {
    const app = buildApp(makeWorkspace());
    const res = await app.request("/orchestrate?work_item=TASK-does-not-exist");
    // Filter for an unknown task = empty plan, not 500.
    expect(res.status).toBe(200);
    const body = (await res.json()) as { runnable_count: number };
    expect(body.runnable_count).toBe(0);
  });

  it("accepts a ?task= filter (the executable subtask) without crashing", async () => {
    const app = buildApp(makeWorkspace());
    const res = await app.request("/orchestrate?task=TASK-does-not-exist");
    expect(res.status).toBe(200);
  });
});
