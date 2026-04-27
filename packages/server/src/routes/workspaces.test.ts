import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureWorkspaceId, initLayout } from "@backlog/config";
import { describe, expect, it } from "vitest";
import type { ServerWorkspace } from "../workspace-context.js";
import { workspacesRoutes } from "./workspaces.js";

function tmpRegistryDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "backlog-routes-reg-"));
}

function makeWorkspace(name = "demo"): { root: string; serverWorkspace: ServerWorkspace } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `backlog-routes-ws-${name}-`));
  initLayout({ root, workspaceName: name });
  const backlogDir = path.join(root, ".backlog");
  return {
    root,
    serverWorkspace: {
      root,
      backlogDir,
      workspace_id: ensureWorkspaceId(backlogDir),
      resolvedFrom: root,
    },
  };
}

describe("GET /workspaces", () => {
  it("returns an empty array when nothing is registered", async () => {
    const dir = tmpRegistryDir();
    const { serverWorkspace } = makeWorkspace();
    const app = workspacesRoutes(serverWorkspace, { registry: { dir } });
    const res = await app.request("/workspaces");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ workspaces: [] });
  });

  it("lists registered workspaces", async () => {
    const dir = tmpRegistryDir();
    const { root, serverWorkspace } = makeWorkspace("alpha");
    const app = workspacesRoutes(serverWorkspace, { registry: { dir } });
    const post = await app.request("/workspaces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: root }),
    });
    expect(post.status).toBe(201);

    const list = await app.request("/workspaces");
    const body = (await list.json()) as { workspaces: { name: string; id: string }[] };
    expect(body.workspaces).toHaveLength(1);
    expect(body.workspaces[0]!.name).toBe("alpha");
    expect(body.workspaces[0]!.id).toMatch(/^WS-[0-9a-f]{8}$/);
  });
});

describe("GET /workspaces/current", () => {
  it("reflects the workspace the server was started with", async () => {
    const dir = tmpRegistryDir();
    const { root, serverWorkspace } = makeWorkspace();
    const app = workspacesRoutes(serverWorkspace, { registry: { dir } });
    const res = await app.request("/workspaces/current");
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
    const app = workspacesRoutes(serverWorkspace, { registry: { dir } });
    const res = await app.request("/workspaces", {
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
    const app = workspacesRoutes(serverWorkspace, { registry: { dir } });
    const res = await app.request("/workspaces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: empty }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("register_failed");
    expect(body.message).toMatch(/No \.backlog/);
  });
});

describe("DELETE /workspaces/:idOrPath", () => {
  it("removes a registered workspace by id", async () => {
    const dir = tmpRegistryDir();
    const { root, serverWorkspace } = makeWorkspace();
    const app = workspacesRoutes(serverWorkspace, { registry: { dir } });

    const created = (await (await app.request("/workspaces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: root }),
    })).json()) as { workspace: { id: string } };

    const res = await app.request(`/workspaces/${created.workspace.id}`, { method: "DELETE" });
    expect(res.status).toBe(200);

    const list = (await (await app.request("/workspaces")).json()) as { workspaces: unknown[] };
    expect(list.workspaces).toHaveLength(0);
  });

  it("returns 404 when nothing matches", async () => {
    const dir = tmpRegistryDir();
    const { serverWorkspace } = makeWorkspace();
    const app = workspacesRoutes(serverWorkspace, { registry: { dir } });
    const res = await app.request("/workspaces/WS-deadbeef", { method: "DELETE" });
    expect(res.status).toBe(404);
  });
});

describe("PUT /workspaces/:id/touch", () => {
  it("updates last_opened_at on a registered workspace", async () => {
    const dir = tmpRegistryDir();
    const { root, serverWorkspace } = makeWorkspace();
    const app = workspacesRoutes(serverWorkspace, { registry: { dir } });

    const created = (await (await app.request("/workspaces", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: root }),
    })).json()) as { workspace: { id: string; last_opened_at: string } };
    const before = created.workspace.last_opened_at;

    await new Promise((r) => setTimeout(r, 5));
    const res = await app.request(`/workspaces/${created.workspace.id}/touch`, { method: "PUT" });
    expect(res.status).toBe(200);

    const list = (await (await app.request("/workspaces")).json()) as {
      workspaces: { last_opened_at: string }[];
    };
    expect(new Date(list.workspaces[0]!.last_opened_at).getTime()).toBeGreaterThan(
      new Date(before).getTime(),
    );
  });

  it("is a no-op (200) for unknown ids", async () => {
    const dir = tmpRegistryDir();
    const { serverWorkspace } = makeWorkspace();
    const app = workspacesRoutes(serverWorkspace, { registry: { dir } });
    const res = await app.request("/workspaces/WS-unknownx/touch", { method: "PUT" });
    expect(res.status).toBe(200);
  });
});
