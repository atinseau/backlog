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

function makeServerProject(name = "demo"): { project: ServerProject; root: string } {
  const root = tmpDir(`backlog-resolver-${name}-`);
  initLayout({ root, projectName: name });
  const backlogDir = path.join(root, ".backlog");
  return {
    root,
    project: {
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
    const project = c.get("project");
    return c.json({ id: project.project_id, root: project.root });
  });
  return app;
}

describe("ProjectResolver", () => {
  it("falls back to the default project when no override is sent", async () => {
    const { project } = makeServerProject();
    const resolver = new ProjectResolver(project, { dir: tmpDir("backlog-reg-") });
    const res = await harness(resolver).request("/echo");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; root: string };
    expect(body.id).toBe(project.project_id);
    expect(body.root).toBe(project.root);
  });

  it("routes ?project=<id> to a registered project", async () => {
    const dir = tmpDir("backlog-reg-");
    const { project: defaultProject } = makeServerProject("default");
    const { project: otherProject, root: otherRoot } = makeServerProject("other");
    registerProject({ projectRoot: otherRoot }, { dir });

    const resolver = new ProjectResolver(defaultProject, { dir });
    const res = await harness(resolver).request(`/echo?project=${otherProject.project_id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; root: string };
    expect(body.id).toBe(otherProject.project_id);
    expect(body.root).toBe(otherProject.root);
  });

  it("keeps ?workspace=<id> as a compatibility alias", async () => {
    const dir = tmpDir("backlog-reg-");
    const { project: defaultProject } = makeServerProject("default");
    const { project: otherProject, root: otherRoot } = makeServerProject("other");
    registerProject({ projectRoot: otherRoot }, { dir });

    const resolver = new ProjectResolver(defaultProject, { dir });
    const res = await harness(resolver).request(`/echo?workspace=${otherProject.project_id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; root: string };
    expect(body.id).toBe(otherProject.project_id);
  });

  it("also accepts the x-backlog-project header", async () => {
    const dir = tmpDir("backlog-reg-");
    const { project: defaultProject } = makeServerProject("default");
    const { project: otherProject, root: otherRoot } = makeServerProject("other");
    registerProject({ projectRoot: otherRoot }, { dir });

    const resolver = new ProjectResolver(defaultProject, { dir });
    const res = await harness(resolver).request("/echo", {
      headers: { "x-backlog-project": otherProject.project_id },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe(otherProject.project_id);
  });

  it("returns the default project by id without consulting the registry", async () => {
    const { project } = makeServerProject();
    const resolver = new ProjectResolver(project, { dir: tmpDir("backlog-reg-") });
    const res = await harness(resolver).request(`/echo?project=${project.project_id}`);
    expect(res.status).toBe(200);
  });

  it("404s when ?project= points at an unregistered id", async () => {
    const { project } = makeServerProject();
    const resolver = new ProjectResolver(project, { dir: tmpDir("backlog-reg-") });
    const res = await harness(resolver).request("/echo?project=WS-deadbeef");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string; project_id: string };
    expect(body.error).toBe("project_not_found");
    expect(body.project_id).toBe("WS-deadbeef");
  });

  it("ignores empty query overrides", async () => {
    const { project } = makeServerProject();
    const resolver = new ProjectResolver(project, { dir: tmpDir("backlog-reg-") });
    const res = await harness(resolver).request("/echo?project=");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe(project.project_id);
  });
});
