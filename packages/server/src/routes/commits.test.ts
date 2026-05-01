import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureProjectId, initLayout } from "@backlog/config";
import { addRepo } from "@backlog/core";
import { git } from "@backlog/git";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { ServerProject } from "../project-context.js";
import type { AppEnv } from "../project-resolver.js";
import { commitsRoutes } from "./commits.js";

function makeProject(): ServerProject {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-git-route-project-"));
  initLayout({ root, projectName: "git-route" });
  const backlogDir = path.join(root, ".backlog");
  return {
    root,
    backlogDir,
    project_id: ensureProjectId(backlogDir),
    resolvedFrom: root,
  };
}

async function makeRepo(): Promise<string> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-git-route-repo-"));
  await git(["init", "-b", "main"], root);
  await git(["config", "user.name", "Backlog"], root);
  await git(["config", "user.email", "backlog@example.com"], root);
  fs.writeFileSync(path.join(root, "README.md"), "# demo\n", "utf8");
  await git(["add", "README.md"], root);
  await git(["commit", "-m", "init"], root);
  return root;
}

function harness(project: ServerProject) {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("project", project);
    await next();
  });
  app.route("/", commitsRoutes());
  return app;
}

describe("git routes", () => {
  it("lists changes and commits selected files", async () => {
    const project = makeProject();
    const repoRoot = await makeRepo();
    addRepo(project.backlogDir, { id: "app", path: repoRoot, defaultBranch: "main" });
    fs.appendFileSync(path.join(repoRoot, "README.md"), "changed\n", "utf8");
    fs.writeFileSync(path.join(repoRoot, "new.ts"), "export const value = 1;\n", "utf8");

    const app = harness(project);
    const changesRes = await app.request("/git/changes?repo=app");
    expect(changesRes.status).toBe(200);
    const changesBody = (await changesRes.json()) as {
      repos: Array<{ repo: string; status: { total: number; modified: number; untracked: number }; changes: Array<{ path: string }> }>;
    };
    expect(changesBody.repos[0]).toMatchObject({
      repo: "app",
      status: { total: 2, modified: 1, untracked: 1 },
    });
    const diffRes = await app.request("/git/diff?repo=app&file=new.ts");
    expect(diffRes.status).toBe(200);
    const diffBody = (await diffRes.json()) as { diff: string };
    expect(diffBody.diff).toContain("+export const value = 1;");

    const commitRes = await app.request("/git/commit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repo: "app", paths: ["new.ts"], message: "add new file" }),
    });
    expect(commitRes.status).toBe(200);
    const statusAfter = await git(["status", "--porcelain=v1"], repoRoot);
    expect(statusAfter).toContain("README.md");
    expect(statusAfter).not.toContain("new.ts");
  });

  it("lists files changed by a commit and returns commit file diffs", async () => {
    const project = makeProject();
    const repoRoot = await makeRepo();
    addRepo(project.backlogDir, { id: "app", path: repoRoot, defaultBranch: "main" });
    fs.appendFileSync(path.join(repoRoot, "README.md"), "history\n", "utf8");
    fs.writeFileSync(path.join(repoRoot, "history.ts"), "export const history = true;\n", "utf8");
    await git(["add", "README.md", "history.ts"], repoRoot);
    await git(["commit", "-m", "history detail"], repoRoot);
    const sha = await git(["rev-parse", "HEAD"], repoRoot);

    const app = harness(project);
    const filesRes = await app.request(`/git/commit-files?repo=app&sha=${sha}`);
    expect(filesRes.status).toBe(200);
    const filesBody = (await filesRes.json()) as { files: Array<{ path: string; kind: string }> };
    expect(filesBody.files).toEqual(expect.arrayContaining([
      { path: "README.md", kind: "modified" },
      { path: "history.ts", kind: "added" },
    ]));

    const diffRes = await app.request(`/git/diff?repo=app&sha=${sha}&file=history.ts`);
    expect(diffRes.status).toBe(200);
    const diffBody = (await diffRes.json()) as { diff: string; sha: string; kind: string };
    expect(diffBody.sha).toBe(sha);
    expect(diffBody.kind).toBe("added");
    expect(diffBody.diff).toContain("+export const history = true;");
  });

  it("syncs an ahead branch to its upstream", async () => {
    const project = makeProject();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-git-sync-"));
    const origin = path.join(tmp, "origin.git");
    const repoRoot = path.join(tmp, "repo");
    await git(["init", "--bare", origin], tmp);
    await git(["clone", origin, repoRoot], tmp);
    await git(["checkout", "-b", "main"], repoRoot);
    await git(["config", "user.name", "Backlog"], repoRoot);
    await git(["config", "user.email", "backlog@example.com"], repoRoot);
    fs.writeFileSync(path.join(repoRoot, "README.md"), "# demo\n", "utf8");
    await git(["add", "README.md"], repoRoot);
    await git(["commit", "-m", "init"], repoRoot);
    await git(["push", "-u", "origin", "main"], repoRoot);
    fs.writeFileSync(path.join(repoRoot, "sync.txt"), "sync me\n", "utf8");
    await git(["add", "sync.txt"], repoRoot);
    await git(["commit", "-m", "sync me"], repoRoot);
    addRepo(project.backlogDir, { id: "app", path: repoRoot, defaultBranch: "main" });

    const app = harness(project);
    const remoteBefore = await app.request("/git/remote?repo=app");
    const beforeBody = (await remoteBefore.json()) as { repos: Array<{ ahead: number; behind: number }> };
    expect(beforeBody.repos[0]).toMatchObject({ ahead: 1, behind: 0 });

    const syncRes = await app.request("/git/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repo: "app" }),
    });
    expect(syncRes.status).toBe(200);
    const syncBody = (await syncRes.json()) as { actions: string[]; state: { ahead: number; behind: number } };
    expect(syncBody.actions).toContain("fetch");
    expect(syncBody.actions).toContain("push");
    expect(syncBody.state).toMatchObject({ ahead: 0, behind: 0 });
  });

  it("lists, creates, checks out, and merges branches", async () => {
    const project = makeProject();
    const repoRoot = await makeRepo();
    addRepo(project.backlogDir, { id: "app", path: repoRoot, defaultBranch: "main" });
    const app = harness(project);

    const createRes = await app.request("/git/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repo: "app", branch: "feature/branch-ui", create: true }),
    });
    expect(createRes.status).toBe(200);
    fs.writeFileSync(path.join(repoRoot, "branch.txt"), "branch work\n", "utf8");
    await git(["add", "branch.txt"], repoRoot);
    await git(["commit", "-m", "branch work"], repoRoot);

    const mainCheckout = await app.request("/git/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repo: "app", branch: "main" }),
    });
    expect(mainCheckout.status).toBe(200);

    const branchesRes = await app.request("/git/branches?repo=app");
    expect(branchesRes.status).toBe(200);
    const branchesBody = (await branchesRes.json()) as {
      repos: Array<{ current_branch: string | null; local: Array<{ name: string; current: boolean }> }>;
    };
    expect(branchesBody.repos[0]?.current_branch).toBe("main");
    expect(branchesBody.repos[0]?.local.map((branch) => branch.name)).toEqual(
      expect.arrayContaining(["main", "feature/branch-ui"]),
    );

    const previewRes = await app.request("/git/branch-preview?repo=app&source=feature/branch-ui");
    expect(previewRes.status).toBe(200);
    const previewBody = (await previewRes.json()) as {
      commits: Array<{ subject: string }>;
      files: Array<{ path: string; kind: string }>;
    };
    expect(previewBody.commits.map((commit) => commit.subject)).toContain("branch work");
    expect(previewBody.files).toEqual(expect.arrayContaining([{ path: "branch.txt", kind: "added" }]));

    const mergeRes = await app.request("/git/merge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repo: "app", source: "feature/branch-ui", strategy: "ff_only" }),
    });
    expect(mergeRes.status).toBe(200);
    expect(fs.readFileSync(path.join(repoRoot, "branch.txt"), "utf8")).toBe("branch work\n");
  });

  it("lists, adds, removes, and prunes worktrees", async () => {
    const project = makeProject();
    const repoRoot = await makeRepo();
    addRepo(project.backlogDir, { id: "app", path: repoRoot, defaultBranch: "main" });
    await git(["switch", "-c", "feature/worktree"], repoRoot);
    await git(["switch", "main"], repoRoot);
    const app = harness(project);
    const worktreePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "backlog-feature-worktree-parent-")), "feature-worktree");

    const addRes = await app.request("/git/worktrees", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repo: "app", path: worktreePath, branch: "feature/worktree" }),
    });
    expect(addRes.status).toBe(200);

    const listRes = await app.request("/git/worktrees?repo=app");
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as { repos: Array<{ worktrees: Array<{ path: string; main: boolean; branch: string | null }> }> };
    expect(listBody.repos[0]?.worktrees).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: fs.realpathSync(repoRoot), main: true }),
      expect.objectContaining({ path: fs.realpathSync(worktreePath), branch: "feature/worktree" }),
    ]));

    const removeRes = await app.request("/git/worktrees/remove", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repo: "app", path: fs.realpathSync(worktreePath) }),
    });
    expect(removeRes.status).toBe(200);

    const pruneRes = await app.request("/git/worktrees/prune", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repo: "app" }),
    });
    expect(pruneRes.status).toBe(200);
  });
});
