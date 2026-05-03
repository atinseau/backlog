import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureProjectId, initLayout } from "@backlog/config";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { ServerProject } from "../project-context.js";
import type { AppEnv } from "../project-resolver.js";
import { reposRoutes } from "./repos.js";

function makeWorkspace(): ServerProject {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-repos-route-"));
  initLayout({
    root,
    projectName: "repos-route-test",
    repos: [
      { id: "alpha", path: path.join(root, "alpha"), default_branch: "main", enabled: true, access_mode: "read-write" },
      { id: "beta", path: path.join(root, "beta"), default_branch: "main", enabled: false, access_mode: "read-write" },
    ],
  });
  // Pre-create the local repo dirs that POST/PATCH would normally
  // resolve to, so add/update flows don't bail on a missing path.
  fs.mkdirSync(path.join(root, "alpha"), { recursive: true });
  fs.mkdirSync(path.join(root, "beta"), { recursive: true });
  fs.mkdirSync(path.join(root, "gamma"), { recursive: true });

  const backlogDir = path.join(root, ".backlog");
  return {
    root,
    backlogDir,
    project_id: ensureProjectId(backlogDir),
    resolvedFrom: root,
  };
}

function buildApp(workspace: ServerProject): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("project", workspace);
    await next();
  });
  app.route("/", reposRoutes());
  return app;
}

describe("GET /repos", () => {
  it("returns the configured repos with their metadata", async () => {
    const app = buildApp(makeWorkspace());
    const res = await app.request("/repos");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { repos: { id: string; name: string; enabled: boolean; path_exists: boolean }[] };
    expect(body.repos.map((r) => r.id).sort()).toEqual(["alpha", "beta"]);
    const beta = body.repos.find((r) => r.id === "beta")!;
    expect(beta.name).toBe("beta");
    expect(beta.enabled).toBe(false);
    expect(beta.path_exists).toBe(true);
  });
});

describe("GET /repos/:id", () => {
  it("returns the repo when it exists", async () => {
    const app = buildApp(makeWorkspace());
    const res = await app.request("/repos/alpha");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { repo: { id: string } };
    expect(body.repo.id).toBe("alpha");
  });

  it("returns 404 for an unknown id", async () => {
    const app = buildApp(makeWorkspace());
    const res = await app.request("/repos/does-not-exist");
    expect(res.status).toBe(404);
    expect((await res.json()) as { error: string }).toEqual({ error: "unknown_repo" });
  });
});

describe("POST /repos", () => {
  it("rejects an empty body with 400 invalid_body", async () => {
    const app = buildApp(makeWorkspace());
    const res = await app.request("/repos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_body");
  });

  it("adds a local-path repo and returns the persisted entry", async () => {
    const project = makeWorkspace();
    const app = buildApp(project);
    const newPath = path.join(project.root, "gamma");

    const res = await app.request("/repos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "gamma", path: newPath, default_branch: "main" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { repo: { id: string; name: string; path: string } };
    expect(body.repo.id).toBe("gamma");
    expect(body.repo.name).toBe("gamma");
    expect(body.repo.path).toBe(newPath);

    // Visible in the list now.
    const list = (await (await app.request("/repos")).json()) as { repos: { id: string }[] };
    expect(list.repos.map((r) => r.id).sort()).toEqual(["alpha", "beta", "gamma"]);
  });

  it("defaults a local repo id to the folder name", async () => {
    const project = makeWorkspace();
    const app = buildApp(project);
    const newPath = path.join(project.root, "twoody-backlog");
    fs.mkdirSync(newPath, { recursive: true });

    const res = await app.request("/repos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: newPath }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { repo: { id: string; name: string; default_branch: string } };
    expect(body.repo.id).toBe("twoody-backlog");
    expect(body.repo.name).toBe("twoody-backlog");
    expect(body.repo.default_branch).toBe("main");
  });
});

describe("PATCH /repos/:id", () => {
  it("toggles enabled and persists", async () => {
    const app = buildApp(makeWorkspace());
    const res = await app.request("/repos/beta", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { repo: { id: string; enabled: boolean } };
    expect(body.repo.enabled).toBe(true);
  });

  it("rejects an invalid body (extra junk)", async () => {
    const app = buildApp(makeWorkspace());
    const res = await app.request("/repos/alpha", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: "not json at all",
    });
    expect(res.status).toBe(400);
  });
});

describe("DELETE /repos/:id", () => {
  it("removes the repo from the workspace", async () => {
    const app = buildApp(makeWorkspace());
    const res = await app.request("/repos/beta", { method: "DELETE" });
    expect(res.status).toBe(200);

    const list = (await (await app.request("/repos")).json()) as { repos: { id: string }[] };
    expect(list.repos.map((r) => r.id)).toEqual(["alpha"]);
  });

  it("returns 404 for an unknown id", async () => {
    const app = buildApp(makeWorkspace());
    const res = await app.request("/repos/missing", { method: "DELETE" });
    expect(res.status).toBe(404);
  });
});
