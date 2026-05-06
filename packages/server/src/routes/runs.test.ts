import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureProjectId, initLayout, loadConfig, saveConfig } from "@backlog/config";
import { createClaim } from "@backlog/claims";
import { addAgent, archiveRun, createRun, createSubTask, createTask, listSubTasks } from "@backlog/core";
import { git } from "@backlog/git";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { ServerProject } from "../project-context.js";
import type { AppEnv } from "../project-resolver.js";
import { runsRoutes } from "./runs.js";

function makeWorkspace(autonomyMode: "observe" | "assist" | "delegate" | "autopilot" = "assist"): ServerProject {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-runs-route-"));
  initLayout({ root, projectName: "runs-route-test" });
  const backlogDir = path.join(root, ".backlog");

  // Tweak autonomy_mode through the supported channel.
  const config = loadConfig(backlogDir);
  config.autonomy_mode = autonomyMode;
  saveConfig(backlogDir, config);

  return {
    root,
    backlogDir,
    project_id: ensureProjectId(backlogDir),
    resolvedFrom: root,
  };
}

async function makeGitWorkspace(autonomyMode: "observe" | "assist" | "delegate" | "autopilot" = "assist"): Promise<ServerProject> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-runs-route-git-"));
  await git(["init", "-b", "main"], root);
  fs.writeFileSync(path.join(root, "README.md"), "# demo\n", "utf8");
  fs.writeFileSync(path.join(root, ".gitignore"), ".backlog/\n", "utf8");
  await git(["add", "README.md", ".gitignore"], root);
  await git(["-c", "user.name=Backlog", "-c", "user.email=backlog@example.com", "commit", "-m", "init"], root);
  initLayout({
    root,
    projectName: "runs-route-test",
    mode: "embedded",
    repos: [{ id: "demo", path: root, default_branch: "main", enabled: true, access_mode: "read-write" }],
  });
  const backlogDir = path.join(root, ".backlog");

  const config = loadConfig(backlogDir);
  config.autonomy_mode = autonomyMode;
  saveConfig(backlogDir, config);

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
  app.route("/", runsRoutes());
  return app;
}

describe("GET /runs", () => {
  it("returns empty runs for a fresh workspace", async () => {
    const app = buildApp(makeWorkspace());
    const res = await app.request("/runs");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { count: number; runs: unknown[] };
    expect(body.count).toBe(0);
    expect(body.runs).toEqual([]);
  });

  it("returns active and archived runs enriched with ownership and protection details", async () => {
    const project = makeWorkspace("delegate");
    const agent = addAgent(project.backlogDir, {
      id: "writer",
      provider: "custom",
      command: "echo ok",
      allowedRepos: ["demo"],
      allowedRisk: ["medium"],
    });
    const task = createTask(project.backlogDir, { title: "Implement feature", repoTargets: ["demo"] });
    const subtask = createSubTask(project.backlogDir, {
      workItemId: task.id,
      title: "Edit API file",
      repo: "demo",
      scopes: ["src/api.ts"],
      preferredAgents: ["writer"],
    });
    const claim = createClaim({
      backlogDir: project.backlogDir,
      repo: "demo",
      repoPath: project.root,
      topic: "Edit API file",
      paths: ["src/api.ts"],
      agentId: "writer",
    });
    createRun({
      backlogDir: project.backlogDir,
      runId: "run_active",
      task: subtask,
      workItem: task,
      agent,
      branch: "backlog/run_active",
      worktreePath: project.root,
      claimIds: [claim.id],
      executionMode: "direct",
    });
    createRun({
      backlogDir: project.backlogDir,
      runId: "run_archived",
      task: subtask,
      workItem: task,
      agent,
      branch: "backlog/run_archived",
      worktreePath: project.root,
      claimIds: [],
      executionMode: "isolated_worktree",
    });
    archiveRun(project.backlogDir, "run_archived");

    const app = buildApp(project);
    const res = await app.request("/runs?scope=all");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { active_count: number; archived_count: number; runs: Array<Record<string, unknown>> };
    expect(body.active_count).toBe(1);
    expect(body.archived_count).toBe(1);
    expect(body.runs.map((run) => run.id)).toEqual(["run_active", "run_archived"]);
    expect(body.runs[0]).toMatchObject({
      active: true,
      task: { id: task.id, title: "Implement feature" },
      subtask: { id: subtask.id, title: "Edit API file", scopes: ["src/api.ts"] },
      owner: { id: "writer", display_name: null, provider: "custom" },
      protected_paths: ["src/api.ts"],
      protects_repository: false,
    });
    expect(body.runs[0]?.claims).toEqual([
      expect.objectContaining({ id: claim.id, paths: ["src/api.ts"], agent_id: "writer" }),
    ]);
  });
});

describe("POST /runs", () => {
  it("rejects with 403 autonomy_mode_observe when autonomy is observe", async () => {
    const app = buildApp(makeWorkspace("observe"));
    const res = await app.request("/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approve: true }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("autonomy_mode_observe");
  });

  it("rejects with 403 approval_required when assist mode and !approve", async () => {
    const app = buildApp(makeWorkspace("assist"));
    const res = await app.request("/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("approval_required");
  });

  it("rejects a body whose fields are the wrong type with 400 invalid_body", async () => {
    const app = buildApp(makeWorkspace());
    // max_start expects a number; passing a string forces zod to fail.
    const res = await app.request("/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ max_start: "lots", approve: true }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_body");
  });

  it("returns an empty plan response (202) when nothing is runnable but the request is otherwise valid", async () => {
    const app = buildApp(makeWorkspace("delegate"));
    const res = await app.request("/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    // No subtasks queued ⇒ scheduler has nothing to start ⇒ 202 No Content (not 201).
    expect([200, 202]).toContain(res.status);
    const body = (await res.json()) as { started?: unknown[]; skipped?: unknown[] };
    expect(body.started ?? []).toEqual([]);
  });

  it("reports a clear skipped reason when a task has no repository to run in", async () => {
    const project = makeWorkspace("assist");
    const task = createTask(project.backlogDir, { title: "Write a file" });
    const app = buildApp(project);

    const res = await app.request("/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task_id: task.id, approve: true }),
    });

    expect(res.status).toBe(202);
    const body = (await res.json()) as {
      started: unknown[];
      skipped: Array<{ taskId: string; reasons: string[] }>;
    };
    expect(body.started).toEqual([]);
    expect(body.skipped).toEqual([
      { taskId: task.id, reasons: ["no_repository_configured"] },
    ]);
  });

  it("auto-creates an implicit execution unit and executes task_id runs in direct mode", async () => {
    const project = await makeGitWorkspace("assist");
    addAgent(project.backlogDir, {
      id: "writer",
      provider: "custom",
      command: "node -e \"require('fs').writeFileSync('task-direct.txt', 'ok\\\\n')\"",
      successMode: "complete",
      allowedRepos: ["demo"],
      allowedRisk: ["medium"],
    });
    const task = createTask(project.backlogDir, {
      title: "Write direct file",
      repoTargets: ["demo"],
      autoCommit: false,
      pushWhenDone: false,
      worktreeMode: "direct",
      preferredAgents: ["writer"],
    });

    const app = buildApp(project);
    const res = await app.request("/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task_id: task.id, agent_id: "writer", approve: true }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { started?: Array<{ worktreePath: string; branch: string }>; skipped?: unknown[] };
    expect(body.skipped ?? []).toEqual([]);
    expect(body.started).toEqual([
      expect.objectContaining({
        worktreePath: project.root,
        branch: "main",
      }),
    ]);
    expect(fs.readFileSync(path.join(project.root, "task-direct.txt"), "utf8")).toBe("ok\n");
    expect(fs.existsSync(path.join(project.backlogDir, "worktrees", "demo"))).toBe(false);
    const executionUnits = listSubTasks(project.backlogDir).filter((unit) => unit.task_id === task.id);
    expect(executionUnits).toHaveLength(1);
    expect(executionUnits[0]?.planner.origin).toBe("implicit");
  });

  it("passes explicit dirty direct checkout approval to the launcher", async () => {
    const project = await makeGitWorkspace("assist");
    addAgent(project.backlogDir, {
      id: "writer",
      provider: "custom",
      command: "node -e \"require('fs').writeFileSync('dirty-direct.txt', 'ok\\\\n')\"",
      successMode: "complete",
      allowedRepos: ["demo"],
      allowedRisk: ["medium"],
    });
    const task = createTask(project.backlogDir, {
      title: "Write direct file anyway",
      repoTargets: ["demo"],
      autoCommit: false,
      pushWhenDone: false,
      worktreeMode: "direct",
      preferredAgents: ["writer"],
    });
    fs.writeFileSync(path.join(project.root, "human-note.txt"), "already here\n", "utf8");

    const app = buildApp(project);
    const res = await app.request("/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        task_id: task.id,
        agent_id: "writer",
        approve: true,
        allow_dirty_direct: true,
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { started?: Array<{ worktreePath: string }>; skipped?: unknown[] };
    expect(body.skipped ?? []).toEqual([]);
    expect(body.started?.[0]?.worktreePath).toBe(project.root);
    expect(fs.readFileSync(path.join(project.root, "dirty-direct.txt"), "utf8")).toBe("ok\n");
    expect(fs.readFileSync(path.join(project.root, "human-note.txt"), "utf8")).toBe("already here\n");
  });
});
