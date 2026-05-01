import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ensureProjectId, initLayout } from "@backlog/config";
import { describe, expect, it } from "vitest";
import type { ServerProject } from "../project-context.js";
import { projectsRoutes } from "./projects.js";

function tmpRegistryDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "backlog-routes-reg-"));
}

function makeProject(name = "demo"): { root: string; serverProject: ServerProject } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `backlog-routes-ws-${name}-`));
  initLayout({ root, projectName: name });
  const backlogDir = path.join(root, ".backlog");
  return {
    root,
    serverProject: {
      root,
      backlogDir,
      project_id: ensureProjectId(backlogDir),
      resolvedFrom: root,
    },
  };
}

describe("GET /projects", () => {
  it("returns an empty array when nothing is registered", async () => {
    const dir = tmpRegistryDir();
    const { serverProject } = makeProject();
    const app = projectsRoutes(serverProject, { registry: { dir } });
    const res = await app.request("/projects");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ projects: [] });
  });

  it("lists registered projects", async () => {
    const dir = tmpRegistryDir();
    const { root, serverProject } = makeProject("alpha");
    const app = projectsRoutes(serverProject, { registry: { dir } });
    const post = await app.request("/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: root }),
    });
    expect(post.status).toBe(201);

    const list = await app.request("/projects");
    const body = (await list.json()) as { projects: { name: string; id: string }[] };
    expect(body.projects).toHaveLength(1);
    expect(body.projects[0]!.name).toBe("alpha");
    expect(body.projects[0]!.id).toMatch(/^WS-[0-9a-f]{8}$/);
  });
});

describe("GET /projects/current", () => {
  it("reflects the project the server was started with", async () => {
    const dir = tmpRegistryDir();
    const { root, serverProject } = makeProject();
    const app = projectsRoutes(serverProject, { registry: { dir } });
    const res = await app.request("/projects/current");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      root,
      backlog_dir: path.join(root, ".backlog"),
      resolved_from: root,
    });
  });
});

describe("POST /projects", () => {
  it("rejects an invalid body", async () => {
    const dir = tmpRegistryDir();
    const { serverProject } = makeProject();
    const app = projectsRoutes(serverProject, { registry: { dir } });
    const res = await app.request("/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_body");
  });

  it("returns 400 when the path has no .backlog directory", async () => {
    const dir = tmpRegistryDir();
    const { serverProject } = makeProject();
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-routes-empty-"));
    const app = projectsRoutes(serverProject, { registry: { dir } });
    const res = await app.request("/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: empty }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("register_failed");
    expect(body.message).toMatch(/No Backlog project/);
  });
});

describe("POST /projects/init with git_url", () => {
  it("clones a remote Git repository, initializes project state, and registers the clone", async () => {
    const dir = tmpRegistryDir();
    const { serverProject } = makeProject();
    const origin = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-routes-origin-"));
    const clonePath = path.join(os.tmpdir(), `backlog-routes-clone-${Date.now()}`);
    execFileSync("git", ["init", "--bare", origin]);

    const app = projectsRoutes(serverProject, { registry: { dir } });
    const res = await app.request("/projects/init", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path: clonePath,
        name: "Remote Demo",
        git_url: origin,
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { project: { path: string; name: string }; repos: Array<{ git_url?: string; path: string; provider?: string }> };
    expect(body.project.path).toBe(clonePath);
    expect(body.project.name).toBe("Remote Demo");
    expect(fs.existsSync(path.join(clonePath, ".git"))).toBe(true);
    expect(fs.existsSync(path.join(clonePath, ".backlog", "config.toml"))).toBe(true);
    expect(body.repos[0]).toMatchObject({
      git_url: origin,
      path: fs.realpathSync(clonePath),
      provider: "other",
    });
  });
});

describe("DELETE /projects/:idOrPath", () => {
  it("removes a registered project by id", async () => {
    const dir = tmpRegistryDir();
    const { root, serverProject } = makeProject();
    const app = projectsRoutes(serverProject, { registry: { dir } });

    const created = (await (await app.request("/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: root }),
    })).json()) as { project: { id: string } };

    const res = await app.request(`/projects/${created.project.id}`, { method: "DELETE" });
    expect(res.status).toBe(200);

    const list = (await (await app.request("/projects")).json()) as { projects: unknown[] };
    expect(list.projects).toHaveLength(0);
  });

  it("returns 404 when nothing matches", async () => {
    const dir = tmpRegistryDir();
    const { serverProject } = makeProject();
    const app = projectsRoutes(serverProject, { registry: { dir } });
    const res = await app.request("/projects/WS-deadbeef", { method: "DELETE" });
    expect(res.status).toBe(404);
  });
});

describe("PUT /projects/:id/touch", () => {
  it("updates last_opened_at on a registered project", async () => {
    const dir = tmpRegistryDir();
    const { root, serverProject } = makeProject();
    const app = projectsRoutes(serverProject, { registry: { dir } });

    const created = (await (await app.request("/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: root }),
    })).json()) as { project: { id: string; last_opened_at: string } };
    const before = created.project.last_opened_at;

    await new Promise((r) => setTimeout(r, 5));
    const res = await app.request(`/projects/${created.project.id}/touch`, { method: "PUT" });
    expect(res.status).toBe(200);

    const list = (await (await app.request("/projects")).json()) as {
      projects: { last_opened_at: string }[];
    };
    expect(new Date(list.projects[0]!.last_opened_at).getTime()).toBeGreaterThan(
      new Date(before).getTime(),
    );
  });

  it("is a no-op (200) for unknown ids", async () => {
    const dir = tmpRegistryDir();
    const { serverProject } = makeProject();
    const app = projectsRoutes(serverProject, { registry: { dir } });
    const res = await app.request("/projects/WS-unknownx/touch", { method: "PUT" });
    expect(res.status).toBe(200);
  });
});
