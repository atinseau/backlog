import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureProjectId, initLayout, getAccountSecret, getProjectSecret, setAccountSecret, setProjectSecret } from "@backlog/config";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ServerProject } from "../project-context.js";
import type { AppEnv } from "../project-resolver.js";
import { secretsRoutes } from "./secrets.js";

let originalHome: string | undefined;

function makeProject(name = "secrets-demo"): ServerProject {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `backlog-secrets-route-${name}-`));
  initLayout({ root, projectName: name });
  const backlogDir = path.join(root, ".backlog");
  return {
    root,
    backlogDir,
    project_id: ensureProjectId(backlogDir),
    resolvedFrom: root,
  };
}

function buildApp(project: ServerProject): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("project", project);
    await next();
  });
  app.route("/", secretsRoutes());
  return app;
}

beforeEach(() => {
  originalHome = process.env.HOME;
  process.env.HOME = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "backlog-secrets-route-home-")));
});

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
});

describe("secrets routes", () => {
  it("lists account secrets as resolved keys", async () => {
    const project = makeProject();
    setAccountSecret("ANTHROPIC_API_KEY", "test-account-key");
    const app = buildApp(project);

    const res = await app.request("/secrets");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      keys: [
        {
          key: "ANTHROPIC_API_KEY",
          set: true,
          scope: "account",
        },
      ],
    });
  });

  it("writes API keys to the account scope from the UI endpoint", async () => {
    const project = makeProject();
    const app = buildApp(project);

    const res = await app.request("/secrets/ANTHROPIC_API_KEY", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "test-account-key" }),
    });

    expect(res.status).toBe(200);
    expect(getAccountSecret("ANTHROPIC_API_KEY")).toBe("test-account-key");
    expect(getProjectSecret(project.backlogDir, "ANTHROPIC_API_KEY")).toBeNull();
  });

  it("deletes both account defaults and project overrides for the UI key", async () => {
    const project = makeProject();
    setAccountSecret("ANTHROPIC_API_KEY", "test-account-key");
    setProjectSecret(project.backlogDir, "ANTHROPIC_API_KEY", "test-project-key");
    const app = buildApp(project);

    const res = await app.request("/secrets/ANTHROPIC_API_KEY", { method: "DELETE" });

    expect(res.status).toBe(200);
    expect(getAccountSecret("ANTHROPIC_API_KEY")).toBeNull();
    expect(getProjectSecret(project.backlogDir, "ANTHROPIC_API_KEY")).toBeNull();
  });
});
