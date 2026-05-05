import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureProjectId, initLayout } from "@backlog/config";
import { git } from "@backlog/git";
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
    const body = (await res.json()) as {
      repos: { id: string; name: string; enabled: boolean; path_exists: boolean }[];
      repositories: { id: string; name: string; enabled: boolean; path_exists: boolean }[];
    };
    expect(body.repos.map((r) => r.id).sort()).toEqual(["alpha", "beta"]);
    expect(body.repositories.map((r) => r.id).sort()).toEqual(["alpha", "beta"]);
    const beta = body.repos.find((r) => r.id === "beta")!;
    expect(beta.name).toBe("beta");
    expect(beta.enabled).toBe(false);
    expect(beta.path_exists).toBe(true);
  });

  it("supports /repositories as the long-form alias", async () => {
    const app = buildApp(makeWorkspace());
    const res = await app.request("/repositories");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { repositories: { id: string }[]; repos: { id: string }[] };
    expect(body.repositories.map((r) => r.id).sort()).toEqual(["alpha", "beta"]);
    expect(body.repos.map((r) => r.id).sort()).toEqual(["alpha", "beta"]);
  });
});

describe("GET /repos/:id", () => {
  it("returns the repo when it exists", async () => {
    const app = buildApp(makeWorkspace());
    const res = await app.request("/repos/alpha");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { repo: { id: string }; repository: { id: string } };
    expect(body.repo.id).toBe("alpha");
    expect(body.repository.id).toBe("alpha");
  });

  it("supports /repositories/:id as the long-form alias", async () => {
    const app = buildApp(makeWorkspace());
    const res = await app.request("/repositories/alpha");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { repo: { id: string }; repository: { id: string } };
    expect(body.repo.id).toBe("alpha");
    expect(body.repository.id).toBe("alpha");
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
    const body = (await res.json()) as { repo: { id: string; name: string; path: string; location?: string }; repository: { id: string; name: string; path: string } };
    expect(body.repo.id).toBe("gamma");
    expect(body.repository.id).toBe("gamma");
    expect(body.repo.name).toBe("gamma");
    expect(body.repo.path).toBe(newPath);
    expect(body.repo.location).toBe("local");

    // Visible in the list now.
    const list = (await (await app.request("/repos")).json()) as { repos: { id: string }[] };
    expect(list.repos.map((r) => r.id).sort()).toEqual(["alpha", "beta", "gamma"]);
  });

  it("supports POST /repositories", async () => {
    const project = makeWorkspace();
    const app = buildApp(project);
    const newPath = path.join(project.root, "gamma");

    const res = await app.request("/repositories", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "gamma", path: newPath, default_branch: "main" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { repository: { id: string } };
    expect(body.repository.id).toBe("gamma");
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

  it("persists remote metadata separately from the local checkout path", async () => {
    const project = makeWorkspace();
    const app = buildApp(project);
    const newPath = path.join(project.root, "gamma");
    const remoteUrl = "https://github.com/acme/gamma.git";

    const res = await app.request("/repositories", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "gamma",
        path: newPath,
        location: "remote",
        remote_type: "git",
        remote_provider: "github",
        remote_url: remoteUrl,
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      repository: {
        id: string;
        location?: string;
        remote_type?: string;
        remote_provider?: string;
        remote_url?: string;
        git_url?: string;
        provider?: string;
      };
    };
    expect(body.repository.id).toBe("gamma");
    expect(body.repository.location).toBe("remote");
    expect(body.repository.remote_type).toBe("git");
    expect(body.repository.remote_provider).toBe("github");
    expect(body.repository.remote_url).toBe(remoteUrl);
    expect(body.repository.git_url).toBe(remoteUrl);
    expect(body.repository.provider).toBe("github");
  });

  it("can register a remote repository without cloning a local checkout", async () => {
    const project = makeWorkspace();
    const app = buildApp(project);
    const remoteUrl = "https://github.com/acme/cloud-only.git";

    const res = await app.request("/repositories", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "cloud-only",
        location: "remote",
        remote_type: "git",
        remote_provider: "github",
        remote_url: remoteUrl,
        checkout: false,
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      repository: {
        id: string;
        path?: string;
        checkout_path?: string;
        has_local_checkout: boolean;
        path_exists: boolean;
        location?: string;
        remote_url?: string;
      };
      cloned: boolean;
    };
    expect(body.cloned).toBe(false);
    expect(body.repository.id).toBe("cloud-only");
    expect(body.repository.location).toBe("remote");
    expect(body.repository.remote_url).toBe(remoteUrl);
    expect(body.repository.has_local_checkout).toBe(false);
    expect(body.repository.path_exists).toBe(false);
    expect(body.repository.path).toBeUndefined();
    expect(body.repository.checkout_path).toBeUndefined();
  });

  it("creates a local checkout for an existing remote-only repository", async () => {
    const project = makeWorkspace();
    const app = buildApp(project);
    const seed = path.join(project.root, "seed");
    const origin = path.join(project.root, "origin.git");
    fs.mkdirSync(seed, { recursive: true });
    await git(["init", "-b", "main"], seed);
    await git(["config", "user.name", "Backlog"], seed);
    await git(["config", "user.email", "backlog@example.com"], seed);
    fs.writeFileSync(path.join(seed, "README.md"), "# cloud\n", "utf8");
    await git(["add", "README.md"], seed);
    await git(["commit", "-m", "init"], seed);
    await git(["clone", "--bare", seed, origin], project.root);

    const createRes = await app.request("/repositories", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "cloud",
        location: "remote",
        remote_type: "git",
        remote_url: origin,
        default_branch: "main",
        checkout: false,
      }),
    });
    expect(createRes.status).toBe(201);

    const checkoutRes = await app.request("/repositories/cloud/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(checkoutRes.status).toBe(200);
    const body = (await checkoutRes.json()) as {
      repository: { id: string; has_local_checkout: boolean; path: string; path_exists: boolean };
      cloned: boolean;
    };
    expect(body.cloned).toBe(true);
    expect(body.repository).toMatchObject({
      id: "cloud",
      has_local_checkout: true,
      path_exists: true,
    });
    expect(fs.existsSync(path.join(body.repository.path, ".git"))).toBe(true);
    expect(fs.readFileSync(path.join(body.repository.path, "README.md"), "utf8")).toBe("# cloud\n");
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

  it("supports PATCH /repositories/:id", async () => {
    const app = buildApp(makeWorkspace());
    const res = await app.request("/repositories/beta", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { repository: { id: string; enabled: boolean } };
    expect(body.repository.id).toBe("beta");
    expect(body.repository.enabled).toBe(true);
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

  it("supports DELETE /repositories/:id", async () => {
    const app = buildApp(makeWorkspace());
    const res = await app.request("/repositories/beta", { method: "DELETE" });
    expect(res.status).toBe(200);

    const list = (await (await app.request("/repositories")).json()) as { repositories: { id: string }[] };
    expect(list.repositories.map((r) => r.id)).toEqual(["alpha"]);
  });

  it("returns 404 for an unknown id", async () => {
    const app = buildApp(makeWorkspace());
    const res = await app.request("/repos/missing", { method: "DELETE" });
    expect(res.status).toBe(404);
  });
});
