import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureWorkspaceId, initLayout, registerWorkspace } from "@backlog/config";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { ServerWorkspace } from "./workspace-context.js";
import { type AppEnv, WorkspaceResolver } from "./workspace-resolver.js";

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeServerWorkspace(name = "demo"): { workspace: ServerWorkspace; root: string } {
  const root = tmpDir(`backlog-resolver-${name}-`);
  initLayout({ root, workspaceName: name });
  const backlogDir = path.join(root, ".backlog");
  return {
    root,
    workspace: {
      root,
      backlogDir,
      workspace_id: ensureWorkspaceId(backlogDir),
      resolvedFrom: root,
    },
  };
}

function harness(resolver: WorkspaceResolver) {
  const app = new Hono<AppEnv>();
  app.use("*", resolver.middleware());
  app.get("/echo", (c) => {
    const workspace = c.get("workspace");
    return c.json({ id: workspace.workspace_id, root: workspace.root });
  });
  return app;
}

describe("WorkspaceResolver", () => {
  it("falls back to the default workspace when no override is sent", async () => {
    const { workspace } = makeServerWorkspace();
    const resolver = new WorkspaceResolver(workspace, { dir: tmpDir("backlog-reg-") });
    const res = await harness(resolver).request("/echo");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; root: string };
    expect(body.id).toBe(workspace.workspace_id);
    expect(body.root).toBe(workspace.root);
  });

  it("routes ?workspace=<id> to a registered workspace", async () => {
    const dir = tmpDir("backlog-reg-");
    const { workspace: defaultWs } = makeServerWorkspace("default");
    const { workspace: otherWs, root: otherRoot } = makeServerWorkspace("other");
    registerWorkspace({ workspaceRoot: otherRoot }, { dir });

    const resolver = new WorkspaceResolver(defaultWs, { dir });
    const res = await harness(resolver).request(`/echo?workspace=${otherWs.workspace_id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; root: string };
    expect(body.id).toBe(otherWs.workspace_id);
    expect(body.root).toBe(otherWs.root);
  });

  it("also accepts the X-Backlog-Workspace header", async () => {
    const dir = tmpDir("backlog-reg-");
    const { workspace: defaultWs } = makeServerWorkspace("default");
    const { workspace: otherWs, root: otherRoot } = makeServerWorkspace("other");
    registerWorkspace({ workspaceRoot: otherRoot }, { dir });

    const resolver = new WorkspaceResolver(defaultWs, { dir });
    const res = await harness(resolver).request("/echo", {
      headers: { "x-backlog-workspace": otherWs.workspace_id },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe(otherWs.workspace_id);
  });

  it("returns the default workspace by id without consulting the registry", async () => {
    const { workspace } = makeServerWorkspace();
    const resolver = new WorkspaceResolver(workspace, { dir: tmpDir("backlog-reg-") });
    const res = await harness(resolver).request(`/echo?workspace=${workspace.workspace_id}`);
    expect(res.status).toBe(200);
  });

  it("404s when ?workspace= points at an unregistered id", async () => {
    const { workspace } = makeServerWorkspace();
    const resolver = new WorkspaceResolver(workspace, { dir: tmpDir("backlog-reg-") });
    const res = await harness(resolver).request("/echo?workspace=WS-deadbeef");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string; workspace_id: string };
    expect(body.error).toBe("workspace_not_found");
    expect(body.workspace_id).toBe("WS-deadbeef");
  });

  it("ignores empty query overrides", async () => {
    const { workspace } = makeServerWorkspace();
    const resolver = new WorkspaceResolver(workspace, { dir: tmpDir("backlog-reg-") });
    const res = await harness(resolver).request("/echo?workspace=");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe(workspace.workspace_id);
  });
});
