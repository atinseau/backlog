import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureWorkspaceId, initLayout, registerWorkspace } from "@backlog/config";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { ServerWorkspace } from "../workspace-context.js";
import { type AppEnv, WorkspaceResolver } from "../workspace-resolver.js";
import { boardRoutes } from "./board.js";

function makeWorkspace(name: string): ServerWorkspace {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `backlog-board-mw-${name}-`));
  initLayout({ root, workspaceName: name });
  const backlogDir = path.join(root, ".backlog");
  return {
    root,
    backlogDir,
    workspace_id: ensureWorkspaceId(backlogDir),
    resolvedFrom: root,
  };
}

describe("board route under multi-workspace resolver", () => {
  it("returns the right workspace's board based on ?workspace=", async () => {
    const registryDir = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-board-mw-reg-"));
    const defaultWs = makeWorkspace("alpha");
    const otherWs = makeWorkspace("beta");
    registerWorkspace({ workspaceRoot: otherWs.root }, { dir: registryDir });

    const resolver = new WorkspaceResolver(defaultWs, { dir: registryDir });
    const app = new Hono<AppEnv>();
    app.use("*", resolver.middleware());
    app.route("/", boardRoutes());

    const defaultRes = await app.request("/board");
    const defaultBody = (await defaultRes.json()) as { workspace: string };
    expect(defaultBody.workspace).toBe(defaultWs.root);

    const overrideRes = await app.request(`/board?workspace=${otherWs.workspace_id}`);
    const overrideBody = (await overrideRes.json()) as { workspace: string };
    expect(overrideBody.workspace).toBe(otherWs.root);
    expect(overrideBody.workspace).not.toBe(defaultBody.workspace);
  });

  it("404s when ?workspace= is unregistered", async () => {
    const registryDir = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-board-mw-reg-"));
    const defaultWs = makeWorkspace("alpha");
    const resolver = new WorkspaceResolver(defaultWs, { dir: registryDir });
    const app = new Hono<AppEnv>();
    app.use("*", resolver.middleware());
    app.route("/", boardRoutes());

    const res = await app.request("/board?workspace=WS-deadbeef");
    expect(res.status).toBe(404);
  });
});
