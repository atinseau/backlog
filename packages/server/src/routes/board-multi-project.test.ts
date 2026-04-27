import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureProjectId, initLayout, registerProject } from "@backlog/config";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { ServerProject } from "../project-context.js";
import { type AppEnv, ProjectResolver } from "../project-resolver.js";
import { boardRoutes } from "./board.js";

function makeWorkspace(name: string): ServerProject {
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

describe("board route under multi-workspace resolver", () => {
  it("returns the right workspace's board based on ?workspace=", async () => {
    const registryDir = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-board-mw-reg-"));
    const defaultWs = makeWorkspace("alpha");
    const otherWs = makeWorkspace("beta");
    registerProject({ projectRoot: otherWs.root }, { dir: registryDir });

    const resolver = new ProjectResolver(defaultWs, { dir: registryDir });
    const app = new Hono<AppEnv>();
    app.use("*", resolver.middleware());
    app.route("/", boardRoutes());

    const defaultRes = await app.request("/board");
    const defaultBody = (await defaultRes.json()) as { workspace: string };
    expect(defaultBody.workspace).toBe(defaultWs.root);

    const overrideRes = await app.request(`/board?workspace=${otherWs.project_id}`);
    const overrideBody = (await overrideRes.json()) as { workspace: string };
    expect(overrideBody.workspace).toBe(otherWs.root);
    expect(overrideBody.workspace).not.toBe(defaultBody.workspace);
  });

  it("404s when ?workspace= is unregistered", async () => {
    const registryDir = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-board-mw-reg-"));
    const defaultWs = makeWorkspace("alpha");
    const resolver = new ProjectResolver(defaultWs, { dir: registryDir });
    const app = new Hono<AppEnv>();
    app.use("*", resolver.middleware());
    app.route("/", boardRoutes());

    const res = await app.request("/board?workspace=WS-deadbeef");
    expect(res.status).toBe(404);
  });
});
