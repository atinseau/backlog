import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureProjectId, initLayout, registerProject } from "@backlog/config";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { ServerProject } from "./project-context.js";
import { type AppEnv, ProjectResolver } from "./project-resolver.js";

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeServerWorkspace(name = "demo"): { workspace: ServerProject; root: string } {
  const root = tmpDir(`backlog-resolver-${name}-`);
  initLayout({ root, projectName: name });
  const backlogDir = path.join(root, ".backlog");
  return {
    root,
    workspace: {
      root,
      backlogDir,
      project_id: ensureProjectId(backlogDir),
      resolvedFrom: root,
    },
  };
}

function harness(resolver: ProjectResolver) {
  const app = new Hono<AppEnv>();
  app.use("*", resolver.middleware());
  app.get("/echo", (c) => {
    const workspace = c.get("workspace");
    return c.json({ id: workspace.project_id, root: workspace.root });
  });
  return app;
}

describe("ProjectResolver", () => {
  it("falls back to the default workspace when no override is sent", async () => {
    const { workspace } = makeServerWorkspace();
    const resolver = new ProjectResolver(workspace, { dir: tmpDir("backlog-reg-") });
    const res = await harness(resolver).request("/echo");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; root: string };
    expect(body.id).toBe(workspace.project_id);
    expect(body.root).toBe(workspace.root);
  });

  it("routes ?workspace=<id> to a registered workspace", async () => {
    const dir = tmpDir("backlog-reg-");
    const { workspace: defaultWs } = makeServerWorkspace("default");
    const { workspace: otherWs, root: otherRoot } = makeServerWorkspace("other");
    registerProject({ projectRoot: otherRoot }, { dir });

    const resolver = new ProjectResolver(defaultWs, { dir });
    const res = await harness(resolver).request(`/echo?workspace=${otherWs.project_id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; root: string };
    expect(body.id).toBe(otherWs.project_id);
    expect(body.root).toBe(otherWs.root);
  });

  it("also accepts the x-backlog-project header", async () => {
    const dir = tmpDir("backlog-reg-");
    const { workspace: defaultWs } = makeServerWorkspace("default");
    const { workspace: otherWs, root: otherRoot } = makeServerWorkspace("other");
    registerProject({ projectRoot: otherRoot }, { dir });

    const resolver = new ProjectResolver(defaultWs, { dir });
    const res = await harness(resolver).request("/echo", {
      headers: { "x-backlog-project": otherWs.project_id },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe(otherWs.project_id);
  });

  it("returns the default workspace by id without consulting the registry", async () => {
    const { workspace } = makeServerWorkspace();
    const resolver = new ProjectResolver(workspace, { dir: tmpDir("backlog-reg-") });
    const res = await harness(resolver).request(`/echo?workspace=${workspace.project_id}`);
    expect(res.status).toBe(200);
  });

  it("404s when ?workspace= points at an unregistered id", async () => {
    const { workspace } = makeServerWorkspace();
    const resolver = new ProjectResolver(workspace, { dir: tmpDir("backlog-reg-") });
    const res = await harness(resolver).request("/echo?workspace=WS-deadbeef");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string; project_id: string };
    expect(body.error).toBe("workspace_not_found");
    expect(body.project_id).toBe("WS-deadbeef");
  });

  it("ignores empty query overrides", async () => {
    const { workspace } = makeServerWorkspace();
    const resolver = new ProjectResolver(workspace, { dir: tmpDir("backlog-reg-") });
    const res = await harness(resolver).request("/echo?workspace=");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe(workspace.project_id);
  });
});
