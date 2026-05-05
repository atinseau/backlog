import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureProjectId, initLayout, setSecret } from "@backlog/config";
import { addRepo } from "@backlog/core";
import { git } from "@backlog/git";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  it("discards selected tracked and untracked changes", async () => {
    const project = makeProject();
    const repoRoot = await makeRepo();
    addRepo(project.backlogDir, { id: "app", path: repoRoot, defaultBranch: "main" });
    fs.appendFileSync(path.join(repoRoot, "README.md"), "local change\n", "utf8");
    fs.writeFileSync(path.join(repoRoot, "scratch.txt"), "scratch\n", "utf8");

    const app = harness(project);
    const discardRes = await app.request("/git/discard", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repo: "app", paths: ["README.md", "scratch.txt"] }),
    });
    expect(discardRes.status).toBe(200);
    expect(fs.readFileSync(path.join(repoRoot, "README.md"), "utf8")).toBe("# demo\n");
    expect(fs.existsSync(path.join(repoRoot, "scratch.txt"))).toBe(false);
    expect(await git(["status", "--porcelain=v1"], repoRoot)).toBe("");
  });

  it("stashes selected changes including untracked files", async () => {
    const project = makeProject();
    const repoRoot = await makeRepo();
    addRepo(project.backlogDir, { id: "app", path: repoRoot, defaultBranch: "main" });
    fs.appendFileSync(path.join(repoRoot, "README.md"), "stash me\n", "utf8");
    fs.writeFileSync(path.join(repoRoot, "scratch.txt"), "scratch\n", "utf8");

    const app = harness(project);
    const stashRes = await app.request("/git/stash", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repo: "app", paths: ["README.md", "scratch.txt"], message: "Backlog test stash" }),
    });
    expect(stashRes.status).toBe(200);
    expect(await git(["status", "--porcelain=v1"], repoRoot)).toBe("");
    const stashes = await git(["stash", "list"], repoRoot);
    expect(stashes).toContain("Backlog test stash");
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

  it("reads history, branches, and commit diffs for GitHub remote-only repositories", async () => {
    const project = makeProject();
    const sha = "abcdef1234567890abcdef1234567890abcdef12";
    const remoteUrl = "https://github.com/acme/cloud.git";
    setSecret(project.backlogDir, "github.pat", "ghp_test_token");
    addRepo(project.backlogDir, {
      id: "cloud",
      defaultBranch: "main",
      location: "remote",
      remoteType: "git",
      remoteProvider: "github",
      remoteUrl,
    });
    const remoteBranches = [
      { name: "main", commit: { sha } },
      { name: "feature/api", commit: { sha: "1234567890abcdef1234567890abcdef12345678" } },
    ];

    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const rawUrl = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
      const url = new URL(rawUrl);
      if (url.pathname === "/repos/acme/cloud/commits" && !url.pathname.endsWith(`/${sha}`)) {
        return Response.json([
          {
            sha,
            commit: {
              message: "remote task_001\n\nbody",
              author: { name: "Ada", date: "2026-05-01T12:00:00.000Z" },
            },
            author: { login: "ada" },
          },
        ]);
      }
      if (url.pathname === "/repos/acme/cloud/branches") {
        return Response.json(remoteBranches);
      }
      if (url.pathname === "/repos/acme/cloud/git/ref/heads/main") {
        return Response.json({ ref: "refs/heads/main", object: { sha } });
      }
      if (url.pathname === "/repos/acme/cloud/git/refs") {
        const body = JSON.parse(String(init?.body ?? "{}")) as { ref?: string; sha?: string };
        const name = body.ref?.replace(/^refs\/heads\//, "") ?? "feature/new-remote";
        remoteBranches.push({ name, commit: { sha: body.sha ?? sha } });
        return Response.json({ ref: `refs/heads/${name}`, object: { sha: body.sha ?? sha } }, { status: 201 });
      }
      if (url.pathname === `/repos/acme/cloud/commits/${sha}`) {
        return Response.json({
          files: [
            {
              filename: "src/app.ts",
              status: "modified",
              patch: "@@ -1 +1 @@\n-old\n+new",
            },
          ],
        });
      }
      if (url.pathname === "/repos/acme/cloud/compare/main...feature/api") {
        return Response.json({
          merge_base_commit: { sha: "1111111111111111111111111111111111111111" },
          commits: [
            {
              sha: "2222222222222222222222222222222222222222",
              commit: {
                message: "feature branch",
                author: { name: "Grace", date: "2026-05-02T12:00:00.000Z" },
              },
              author: { login: "grace" },
            },
          ],
          files: [
            {
              filename: "src/feature.ts",
              status: "added",
              patch: "@@ -0,0 +1 @@\n+export const feature = true;",
            },
          ],
        });
      }
      if (url.pathname === "/repos/acme/cloud/merges") {
        return Response.json({ sha: "3333333333333333333333333333333333333333" }, { status: 201 });
      }
      if (url.pathname === "/repos/acme/cloud/pulls") {
        const body = JSON.parse(String(init?.body ?? "{}")) as { head?: string; base?: string; title?: string };
        return Response.json({
          number: 42,
          html_url: "https://github.com/acme/cloud/pull/42",
          state: "open",
          title: body.title ?? "Merge feature/api into main",
          head: { ref: body.head ?? "feature/api" },
          base: { ref: body.base ?? "main" },
        }, { status: 201 });
      }
      return new Response("not found", { status: 404, statusText: "Not Found" });
    });

    const app = harness(project);
    const commitsRes = await app.request("/commits?repository=cloud");
    expect(commitsRes.status).toBe(200);
    const commitsBody = (await commitsRes.json()) as {
      commits: Array<{ repo: string; sha: string; subject: string; links: Array<{ id: string }> }>;
    };
    expect(commitsBody.commits).toEqual([
      expect.objectContaining({
        repo: "cloud",
        sha,
        subject: "remote task_001",
        links: [expect.objectContaining({ id: "task_001" })],
      }),
    ]);

    const branchesRes = await app.request("/git/branches?repository=cloud");
    expect(branchesRes.status).toBe(200);
    const branchesBody = (await branchesRes.json()) as {
      repositories: Array<{ current_branch: string | null; remote: Array<{ name: string; short_name: string }> }>;
    };
    expect(branchesBody.repositories[0]).toMatchObject({
      current_branch: "main",
      remote: [
        { name: "origin/main", short_name: "main" },
        { name: "origin/feature/api", short_name: "feature/api" },
      ],
    });

    const previewRes = await app.request("/git/branch-preview?repository=cloud&source=origin%2Ffeature%2Fapi&target=main");
    expect(previewRes.status).toBe(200);
    const previewBody = (await previewRes.json()) as {
      base: string;
      source: string;
      target: string;
      commits: Array<{ subject: string; author: string }>;
      files: Array<{ path: string; kind: string }>;
    };
    expect(previewBody).toMatchObject({
      base: "1111111111111111111111111111111111111111",
      source: "origin/feature/api",
      target: "main",
      commits: [expect.objectContaining({ subject: "feature branch", author: "grace" })],
      files: [{ path: "src/feature.ts", kind: "added" }],
    });

    const createBranchRes = await app.request("/git/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repo: "cloud", branch: "feature/new-remote", create: true }),
    });
    expect(createBranchRes.status).toBe(200);
    const createBranchBody = (await createBranchRes.json()) as {
      state: { remote: Array<{ name: string; short_name: string }> };
    };
    expect(createBranchBody.state.remote).toEqual(expect.arrayContaining([
      { name: "origin/feature/new-remote", remote: "origin", short_name: "feature/new-remote" },
    ]));

    const mergeRes = await app.request("/git/merge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repo: "cloud", source: "origin/feature/api", strategy: "auto" }),
    });
    expect(mergeRes.status).toBe(200);
    const mergeBody = (await mergeRes.json()) as { sha: string; short_sha: string; state: { current_branch: string | null } };
    expect(mergeBody).toMatchObject({
      sha: "3333333333333333333333333333333333333333",
      short_sha: "3333333",
      state: { current_branch: "main" },
    });

    const prRes = await app.request("/git/pull-request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        repo: "cloud",
        source: "origin/feature/api",
        target: "main",
        title: "Ship API branch",
      }),
    });
    expect(prRes.status).toBe(200);
    const prBody = (await prRes.json()) as {
      url: string;
      pull_request: { number: number; url: string; head: string; base: string; title: string };
    };
    expect(prBody).toMatchObject({
      url: "https://github.com/acme/cloud/pull/42",
      pull_request: {
        number: 42,
        url: "https://github.com/acme/cloud/pull/42",
        head: "feature/api",
        base: "main",
        title: "Ship API branch",
      },
    });

    const changesRes = await app.request("/git/changes?repository=cloud");
    expect(changesRes.status).toBe(200);
    const changesBody = (await changesRes.json()) as { repositories: Array<{ status: { clean: boolean; total: number; error?: string } }> };
    expect(changesBody.repositories[0]?.status).toMatchObject({ clean: true, total: 0 });
    expect(changesBody.repositories[0]?.status.error).toBeUndefined();

    const remoteRes = await app.request("/git/remote?repository=cloud");
    expect(remoteRes.status).toBe(200);
    const remoteBody = (await remoteRes.json()) as { repositories: Array<{ branch: string; remote_url: string; has_upstream: boolean }> };
    expect(remoteBody.repositories[0]).toMatchObject({ branch: "main", remote_url: remoteUrl, has_upstream: false });

    const filesRes = await app.request(`/git/commit-files?repository=cloud&sha=${sha}`);
    expect(filesRes.status).toBe(200);
    const filesBody = (await filesRes.json()) as { files: Array<{ path: string; kind: string }> };
    expect(filesBody.files).toEqual([{ path: "src/app.ts", kind: "modified" }]);

    const diffRes = await app.request(`/git/diff?repository=cloud&sha=${sha}&file=src/app.ts`);
    expect(diffRes.status).toBe(200);
    const diffBody = (await diffRes.json()) as { diff: string; kind: string };
    expect(diffBody.kind).toBe("modified");
    expect(diffBody.diff).toContain("+new");

    const branchDiffRes = await app.request("/git/diff?repository=cloud&base=main&head=origin%2Ffeature%2Fapi&file=src/feature.ts");
    expect(branchDiffRes.status).toBe(200);
    const branchDiffBody = (await branchDiffRes.json()) as { diff: string; kind: string };
    expect(branchDiffBody.kind).toBe("added");
    expect(branchDiffBody.diff).toContain("+export const feature = true;");
    expect(fetchMock).toHaveBeenCalled();
  });
});
