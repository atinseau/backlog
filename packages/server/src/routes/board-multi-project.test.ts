import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureProjectId, initLayout, registerProject } from "@backlog/config";
import { addRepo, archiveTask, completeRun, createRun, createTask, taskExecutionTarget } from "@backlog/core";
import type { Agent } from "@backlog/schemas";
import { git } from "@backlog/git";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { ServerProject } from "../project-context.js";
import { type AppEnv, ProjectResolver } from "../project-resolver.js";
import { boardRoutes } from "./board.js";

function makeProject(name: string): ServerProject {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `backlog-board-mw-${name}-`));
  initLayout({ root, projectName: name });
  const backlogDir = path.join(root, ".backlog");
  return {
    root,
    backlogDir,
    project_id: ensureProjectId(backlogDir),
    resolvedFrom: root,
  };
}

describe("board route under multi-project resolver", () => {
  it("returns the right project's board based on ?project=", async () => {
    const registryDir = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-board-mw-reg-"));
    const defaultProject = makeProject("alpha");
    const otherProject = makeProject("beta");
    registerProject({ projectRoot: otherProject.root }, { dir: registryDir });

    const resolver = new ProjectResolver(defaultProject, { dir: registryDir });
    const app = new Hono<AppEnv>();
    app.use("*", resolver.middleware());
    app.route("/", boardRoutes());

    const defaultRes = await app.request("/board");
    const defaultBody = (await defaultRes.json()) as { project: string };
    expect(defaultBody.project).toBe(defaultProject.root);

    const overrideRes = await app.request(`/board?project=${otherProject.project_id}`);
    const overrideBody = (await overrideRes.json()) as { project: string };
    expect(overrideBody.project).toBe(otherProject.root);
    expect(overrideBody.project).not.toBe(defaultBody.project);
  });

  it("404s when ?project= is unregistered", async () => {
    const registryDir = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-board-mw-reg-"));
    const defaultProject = makeProject("alpha");
    const resolver = new ProjectResolver(defaultProject, { dir: registryDir });
    const app = new Hono<AppEnv>();
    app.use("*", resolver.middleware());
    app.route("/", boardRoutes());

    const res = await app.request("/board?project=WS-deadbeef");
    expect(res.status).toBe(404);
  });

  it("includes git working tree summaries for configured repositories", async () => {
    const registryDir = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-board-mw-reg-"));
    const project = makeProject("git-status");
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-board-repo-"));
    await git(["init", "-b", "main"], repoRoot);
    fs.writeFileSync(path.join(repoRoot, "README.md"), "# demo\n", "utf8");
    await git(["add", "README.md"], repoRoot);
    await git(
      ["-c", "user.name=Backlog", "-c", "user.email=backlog@example.com", "commit", "-m", "init"],
      repoRoot,
    );
    fs.appendFileSync(path.join(repoRoot, "README.md"), "dirty\n", "utf8");
    fs.writeFileSync(path.join(repoRoot, "new.ts"), "export const value = 1;\n", "utf8");
    addRepo(project.backlogDir, { id: "app", path: repoRoot, defaultBranch: "main" });

    const resolver = new ProjectResolver(project, { dir: registryDir });
    const app = new Hono<AppEnv>();
    app.use("*", resolver.middleware());
    app.route("/", boardRoutes());

    const res = await app.request("/board");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      repo_git_statuses: Record<string, { total: number; modified: number; untracked: number }>;
    };
    expect(body.repo_git_statuses.app).toMatchObject({
      total: 2,
      modified: 1,
      untracked: 1,
    });
  });

  it("hides archived tasks from the board", async () => {
    const registryDir = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-board-mw-reg-"));
    const project = makeProject("archive");
    const visible = createTask(project.backlogDir, { title: "visible task" });
    const archived = createTask(project.backlogDir, { title: "archived task" });
    archiveTask(project.backlogDir, archived.id);

    const resolver = new ProjectResolver(project, { dir: registryDir });
    const app = new Hono<AppEnv>();
    app.use("*", resolver.middleware());
    app.route("/", boardRoutes());

    const res = await app.request("/board");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { columns: Record<string, Array<{ id: string }>> };
    const ids = Object.values(body.columns).flat().map((card) => card.id);
    expect(ids).toContain(visible.id);
    expect(ids).not.toContain(archived.id);
  });

  it("orders newer tasks first when there is no manual rank", async () => {
    const registryDir = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-board-mw-reg-"));
    const project = makeProject("recent-first");
    const older = createTask(project.backlogDir, { title: "older task" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const newer = createTask(project.backlogDir, { title: "newer task" });

    const resolver = new ProjectResolver(project, { dir: registryDir });
    const app = new Hono<AppEnv>();
    app.use("*", resolver.middleware());
    app.route("/", boardRoutes());

    const res = await app.request("/board");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { columns: { todo: Array<{ id: string }> } };
    expect(body.columns.todo.map((card) => card.id).slice(0, 2)).toEqual([newer.id, older.id]);
  });

  it("renders completed direct task runs at 100 percent", async () => {
    const registryDir = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-board-mw-reg-"));
    const project = makeProject("direct-done-progress");
    const workItem = createTask(project.backlogDir, { title: "direct task", repoTargets: ["app"] });
    const agent: Agent = {
      id: "agent",
      provider: "custom",
      command: "true",
      enabled: true,
      max_concurrent_runs: 1,
      allowed_repos: [],
      allowed_risk: ["low", "medium", "high"],
      capabilities: ["edit_code"],
      environment: {},
      retry_policy: { mode: "none", max_attempts: 1, reuse_worktree: true },
    };
    createRun({
      backlogDir: project.backlogDir,
      runId: "RUN-direct",
      task: taskExecutionTarget(workItem, "app"),
      workItem,
      agent,
      branch: "main",
      worktreePath: project.root,
      claimIds: [],
      executionMode: "direct",
    });
    await completeRun(project.backlogDir, "RUN-direct", "done");

    const resolver = new ProjectResolver(project, { dir: registryDir });
    const app = new Hono<AppEnv>();
    app.use("*", resolver.middleware());
    app.route("/", boardRoutes());

    const res = await app.request("/board");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      columns: { done: Array<{ id: string; progress_percent: number; tasks: Array<{ status: string; progress_percent: number }> }> };
    };
    expect(body.columns.done[0]).toMatchObject({
      id: workItem.id,
      progress_percent: 100,
      tasks: [expect.objectContaining({ status: "completed", progress_percent: 100 })],
    });
  });
});
