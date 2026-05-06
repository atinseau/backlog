import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureProjectId, initLayout } from "@backlog/config";
import { recordUsage } from "@backlog/core";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { ServerProject } from "../project-context.js";
import type { AppEnv } from "../project-resolver.js";
import { usageRoutes } from "./usage.js";

function makeProject(): ServerProject {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-usage-route-"));
  initLayout({ root, projectName: "usage-route-test" });
  const backlogDir = path.join(root, ".backlog");
  return {
    root,
    backlogDir,
    project_id: ensureProjectId(backlogDir),
    resolvedFrom: root,
  };
}

function seedRun(backlogDir: string, runId: string): void {
  const dir = path.join(backlogDir, "runs", "active", runId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "events.ndjson"), "", "utf8");
}

function buildApp(project: ServerProject): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("project", project);
    await next();
  });
  app.route("/", usageRoutes());
  return app;
}

describe("GET /usage", () => {
  it("returns totals, timeline, model and run breakdowns", async () => {
    const project = makeProject();
    seedRun(project.backlogDir, "RUN-usage");
    recordUsage(project.backlogDir, "RUN-usage", {
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      input_tokens: 1000,
      output_tokens: 500,
      ts: "2026-05-01T12:00:00.000Z",
    });

    const app = buildApp(project);
    const res = await app.request("/usage?period=all&bucket=day");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      totals: { input_tokens: number; output_tokens: number };
      by_model: Array<{ model: string; total_tokens: number }>;
      timeline: Array<{ bucket: string; total_tokens: number }>;
      runs: Array<{ run_id: string; total_tokens: number }>;
    };
    expect(body.totals.input_tokens).toBe(1000);
    expect(body.totals.output_tokens).toBe(500);
    expect(body.by_model).toEqual([
      expect.objectContaining({ model: "claude-sonnet-4-5", total_tokens: 1500 }),
    ]);
    expect(body.timeline).toEqual([
      expect.objectContaining({ bucket: "2026-05-01", total_tokens: 1500 }),
    ]);
    expect(body.runs).toEqual([
      expect.objectContaining({ run_id: "RUN-usage", total_tokens: 1500 }),
    ]);
  });

  it("rejects invalid query values", async () => {
    const app = buildApp(makeProject());
    const res = await app.request("/usage?period=forever");
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toEqual(expect.objectContaining({ error: "invalid_query" }));
  });
});
