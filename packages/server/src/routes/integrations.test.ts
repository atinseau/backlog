import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureProjectId, initLayout, loadConfig, setSecret } from "@backlog/config";
import { repoCheckoutPath } from "@backlog/schemas";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { ServerProject } from "../project-context.js";
import type { AppEnv } from "../project-resolver.js";
import { integrationsRoutes } from "./integrations.js";

function makeProject(): ServerProject {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-integrations-route-"));
  initLayout({ root, projectName: "integrations-route" });
  const backlogDir = path.join(root, ".backlog");
  return {
    root,
    backlogDir,
    project_id: ensureProjectId(backlogDir),
    resolvedFrom: root,
  };
}

function harness(project: ServerProject) {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("project", project);
    await next();
  });
  app.route("/", integrationsRoutes());
  return app;
}

describe("GitHub integrations", () => {
  it("registers a GitHub repository without cloning when checkout is false", async () => {
    const project = makeProject();
    setSecret(project.backlogDir, "github.pat", "ghp_test_token");
    const app = harness(project);

    const res = await app.request("/integrations/github/clone", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        full_name: "acme/cloud",
        default_branch: "trunk",
        checkout: false,
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      cloned: boolean;
      repository: { id: string; location?: string; remote_provider?: string; remote_url?: string };
    };
    expect(body.cloned).toBe(false);
    expect(body.repository).toMatchObject({
      id: "cloud",
      location: "remote",
      remote_provider: "github",
      remote_url: "https://github.com/acme/cloud.git",
    });

    const repo = loadConfig(project.backlogDir).repos.find((candidate) => candidate.id === "cloud");
    expect(repo?.default_branch).toBe("trunk");
    expect(repo ? repoCheckoutPath(repo) : undefined).toBeUndefined();
  });
});
