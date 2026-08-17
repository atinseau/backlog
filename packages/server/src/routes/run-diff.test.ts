import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureProjectId, initLayout } from "@backlog/config";
import { createRun, createSubTask, createTask, getAgent } from "@backlog/core";
import { git } from "@backlog/git";
import { Hono } from "hono";
import { describe, expect, it } from "bun:test";
import type { ServerProject } from "../project-context.js";
import type { AppEnv } from "../project-resolver.js";
import { runDiffRoutes } from "./run-diff.js";

async function makeWorkspace(): Promise<{ workspace: ServerProject; root: string; backlogDir: string }> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-run-diff-"));
  await git(["init", "-b", "main"], root);
  fs.writeFileSync(path.join(root, "README.md"), "# demo\n", "utf8");
  await git(["add", "README.md"], root);
  await git(["-c", "user.name=Backlog", "-c", "user.email=backlog@example.com", "commit", "-m", "init"], root);
  initLayout({
    root,
    projectName: "run-diff-test",
    mode: "embedded",
    repos: [{ id: "demo", path: root, default_branch: "main", enabled: true, access_mode: "read-write" }],
  });
  const backlogDir = path.join(root, ".backlog");
  return {
    root,
    backlogDir,
    workspace: {
      root,
      backlogDir,
      project_id: ensureProjectId(backlogDir),
      resolvedFrom: root,
    },
  };
}

function buildApp(workspace: ServerProject): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("project", workspace);
    await next();
  });
  app.route("/", runDiffRoutes());
  return app;
}

describe("GET /runs/:id/diff", () => {
  it("returns file content for an empty generated file instead of a header-only diff", async () => {
    const { workspace, root, backlogDir } = await makeWorkspace();
    const workItem = createTask(backlogDir, { title: "create empty file", repoTargets: ["demo"] });
    const subtask = createSubTask(backlogDir, { workItemId: workItem.id, title: "create empty file", repo: "demo" });
    const agent = getAgent(backlogDir, "claude-code");
    if (!agent) throw new Error("Expected claude-code agent");
    createRun({
      backlogDir,
      runId: "run_001",
      task: subtask,
      workItem,
      agent,
      branch: "main",
      worktreePath: root,
      claimIds: [],
      executionMode: "direct",
    });
    fs.writeFileSync(path.join(root, "empty.txt"), "", "utf8");

    const app = buildApp(workspace);
    const res = await app.request("/runs/run_001/diff?file=empty.txt");

    expect(res.status).toBe(200);
    const body = (await res.json()) as { view: string; content: string; content_empty: boolean; diff: string; empty: boolean };
    expect(body).toMatchObject({
      view: "content",
      content: "",
      content_empty: true,
      diff: "",
      empty: true,
    });
  });
});
