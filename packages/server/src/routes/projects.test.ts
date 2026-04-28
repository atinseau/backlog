import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureProjectId, initLayout } from "@backlog/config";
import { describe, expect, it } from "vitest";
import type { ServerProject } from "../project-context.js";
import { projectsRoutes } from "./projects.js";

function tmpRegistryDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "backlog-routes-reg-"));
}

function makeWorkspace(name = "demo"): { root: string; serverWorkspace: ServerProject } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `backlog-routes-ws-${name}-`));
  initLayout({ root, projectName: name });
  const backlogDir = path.join(root, ".backlog");
  return {
    root,
    serverWorkspace: {
      root,
      backlogDir,
      project_id: ensureProjectId(backlogDir),
      resolvedFrom: root,
    },
  };
}

describe("GET /workspaces", () => {
  it("returns an empty array when nothing is registered", async () => {
    const dir = tmpRegistryDir();
    const { serverWorkspace } = makeWorkspace();
    const app = projectsRoutes(serverWorkspace, { registry: { dir } });
    const res = await app.request("/projects");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ projects: [] });
  });

  it("lists registered workspaces", async () => {
    const dir = tmpRegistryDir();
    const { root, serverWorkspace } = makeWorkspace("alpha");
    const app = projectsRoutes(serverWorkspace, { registry: { dir } });
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

describe("GET /workspaces/current", () => {
  it("reflects the workspace the server was started with", async () => {
    const dir = tmpRegistryDir();
    const { root, serverWorkspace } = makeWorkspace();
    const app = projectsRoutes(serverWorkspace, { registry: { dir } });
    const res = await app.request("/projects/current");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      root,
      backlog_dir: path.join(root, ".backlog"),
      resolved_from: root,
    });
  });
});

describe("POST /workspaces", () => {
  it("rejects an invalid body", async () => {
    const dir = tmpRegistryDir();
    const { serverWorkspace } = makeWorkspace();
    const app = projectsRoutes(serverWorkspace, { registry: { dir } });
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
    const { serverWorkspace } = makeWorkspace();
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-routes-empty-"));
    const app = projectsRoutes(serverWorkspace, { registry: { dir } });
    const res = await app.request("/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: empty }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("register_failed");
    expect(body.message).toMatch(/No Backlog workspace/);
  });
});

describe("DELETE /workspaces/:idOrPath", () => {
  it("removes a registered workspace by id", async () => {
    const dir = tmpRegistryDir();
    const { root, serverWorkspace } = makeWorkspace();
    const app = projectsRoutes(serverWorkspace, { registry: { dir } });

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
    const { serverWorkspace } = makeWorkspace();
    const app = projectsRoutes(serverWorkspace, { registry: { dir } });
    const res = await app.request("/projects/WS-deadbeef", { method: "DELETE" });
    expect(res.status).toBe(404);
  });
});

describe("PUT /workspaces/:id/touch", () => {
  it("updates last_opened_at on a registered workspace", async () => {
    const dir = tmpRegistryDir();
    const { root, serverWorkspace } = makeWorkspace();
    const app = projectsRoutes(serverWorkspace, { registry: { dir } });

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
    const { serverWorkspace } = makeWorkspace();
    const app = projectsRoutes(serverWorkspace, { registry: { dir } });
    const res = await app.request("/projects/WS-unknownx/touch", { method: "PUT" });
    expect(res.status).toBe(200);
  });
});
