import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureProjectId, initLayout, registerProject } from "@backlog/config";
import { addRepo } from "@backlog/core";
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
});
