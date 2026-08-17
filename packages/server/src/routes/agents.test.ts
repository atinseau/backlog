import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureProjectId, initLayout } from "@backlog/config";
import { Hono } from "hono";
import { describe, expect, it } from "bun:test";
import type { ServerProject } from "../project-context.js";
import type { AppEnv } from "../project-resolver.js";
import { agentsRoutes } from "./agents.js";

interface AgentSummary {
  id: string;
  provider: string;
  model: string | null;
  auth_mode: string | null;
  needs_api_key: boolean;
}

interface ProviderSummary {
  id: string;
  display_name: string;
  models: Array<{ value: string }>;
  reasoning: { supported: boolean; levels: Array<{ value: string }>; allows_custom: boolean };
  auth_modes: string[];
  capabilities: { execute_run: boolean };
  requires_command: boolean;
}

function buildApp(): Hono<AppEnv> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-agents-route-"));
  initLayout({
    root,
    projectName: "agents-route-test",
    repos: [{ id: "backlog", path: root, default_branch: "main", enabled: true }],
  });
  const backlogDir = path.join(root, ".backlog");
  const workspace: ServerProject = {
    root,
    backlogDir,
    project_id: ensureProjectId(backlogDir),
    resolvedFrom: root,
  };

  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("project", workspace);
    await next();
  });
  app.route("/", agentsRoutes());
  return app;
}

async function postAgent(app: Hono<AppEnv>, body: Record<string, unknown>) {
  return app.request("/agents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /providers", () => {
  it("serves the runtime catalogue so the UI needs no hardcoded list", async () => {
    const res = await buildApp().request("/providers");

    expect(res.status).toBe(200);
    const body = (await res.json()) as { providers: ProviderSummary[] };
    expect(body.providers.map((provider) => provider.id)).toContain("claude-code");
  });

  it("describes each runtime's models, reasoning levels and auth modes", async () => {
    const res = await buildApp().request("/providers");
    const body = (await res.json()) as { providers: ProviderSummary[] };

    const claude = body.providers.find((provider) => provider.id === "claude-code")!;
    expect(claude.models.map((model) => model.value)).toContain("opus");
    expect(claude.reasoning.levels.map((level) => level.value)).toContain("xhigh");
    expect(claude.reasoning.allows_custom).toBe(true);
    expect(claude.auth_modes).toContain("subscription");
  });

  it("flags which runtimes can actually back an agent", async () => {
    const res = await buildApp().request("/providers");
    const body = (await res.json()) as { providers: ProviderSummary[] };

    expect(body.providers.find((provider) => provider.id === "claude-code")?.capabilities.execute_run).toBe(true);
    expect(body.providers.find((provider) => provider.id === "anthropic-api")?.capabilities.execute_run).toBe(false);
  });
});

describe("POST /agents", () => {
  it("creates an agent on the canonical provider id", async () => {
    const res = await postAgent(buildApp(), { id: "my-claude", provider: "claude-code" });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { agent: { id: string; provider: string } };
    expect(body.agent.provider).toBe("claude-code");
  });

  it("still accepts the legacy provider id", async () => {
    const res = await postAgent(buildApp(), { id: "legacy", provider: "claude" });

    expect(res.status).toBe(201);
  });

  it("records the auth mode", async () => {
    const app = buildApp();
    await postAgent(app, { id: "on-plan", provider: "claude-code", auth_mode: "subscription" });

    const res = await app.request("/agents");
    const body = (await res.json()) as { agents: AgentSummary[] };
    expect(body.agents.find((agent) => agent.id === "on-plan")?.auth_mode).toBe("subscription");
  });

  it("rejects a runtime nothing backs", async () => {
    const res = await postAgent(buildApp(), { id: "nope", provider: "telepathy" });

    expect(res.status).toBe(400);
  });

  it("rejects codex — the runtime was removed, not renamed", async () => {
    const res = await postAgent(buildApp(), { id: "my-codex", provider: "codex" });

    expect(res.status).toBe(400);
  });

  it("rejects a duplicate id with a conflict", async () => {
    const app = buildApp();
    await postAgent(app, { id: "dup", provider: "claude-code" });

    expect((await postAgent(app, { id: "dup", provider: "claude-code" })).status).toBe(409);
  });
});

describe("GET /agents", () => {
  it("marks agents the orchestrator can actually launch", async () => {
    const app = buildApp();
    await postAgent(app, { id: "runnable", provider: "claude-code" });

    const res = await app.request("/agents");
    const body = (await res.json()) as { agents: Array<AgentSummary & { can_execute: boolean }> };
    expect(body.agents.find((agent) => agent.id === "runnable")?.can_execute).toBe(true);
  });

  it("marks a custom agent launchable once it carries a command", async () => {
    const app = buildApp();
    await postAgent(app, { id: "with-cmd", provider: "custom", command: "./run.sh" });

    const res = await app.request("/agents");
    const body = (await res.json()) as { agents: Array<AgentSummary & { can_execute: boolean }> };
    expect(body.agents.find((agent) => agent.id === "with-cmd")?.can_execute).toBe(true);
  });

  it("no longer claims a Claude agent needs an API key", async () => {
    const app = buildApp();
    await postAgent(app, { id: "on-plan", provider: "claude-code" });

    const res = await app.request("/agents");
    const body = (await res.json()) as { agents: AgentSummary[] };
    expect(body.agents.find((agent) => agent.id === "on-plan")?.needs_api_key).toBe(false);
  });
});

describe("PATCH /agents/:id", () => {
  it("updates the auth mode", async () => {
    const app = buildApp();
    await postAgent(app, { id: "flexible", provider: "claude-code" });

    const res = await app.request("/agents/flexible", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ auth_mode: "api_key" }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { agent: { auth_mode: string } };
    expect(body.agent.auth_mode).toBe("api_key");
  });
});
