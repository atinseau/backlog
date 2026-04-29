import { addAgent, deleteAgent, listActiveRuns, listAgents, updateAgent } from "@backlog/core";
import { hasSecret } from "@backlog/config";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../project-resolver.js";

// Map a provider id to the secret key its executor needs at runtime.
// Returning null means "no key required" (custom agents own their env;
// manual is non-executable).
function requiredSecretKey(provider: string): string | null {
  if (provider === "claude") return "ANTHROPIC_API_KEY";
  if (provider === "codex") return "OPENAI_API_KEY";
  return null;
}

const updateBodySchema = z
  .object({
    enabled: z.boolean().optional(),
    max_concurrent_runs: z.number().int().positive().optional(),
    sandbox_mode: z.enum(["read-only", "workspace-write", "danger-full-access"]).nullable().optional(),
    success_mode: z.enum(["review", "complete"]).nullable().optional(),
    allowed_repos: z.array(z.string()).optional(),
    allowed_risk: z.array(z.enum(["low", "medium", "high"])).optional(),
    capabilities: z.array(z.string()).optional(),
    model: z.string().nullable().optional(),
    profile: z.string().nullable().optional(),
  })
  .strict();

const createBodySchema = z
  .object({
    id: z.string().min(1).regex(/^[a-zA-Z0-9_-]+$/, "id must match [A-Za-z0-9_-]"),
    provider: z.enum(["claude", "codex", "custom", "manual"]),
    model: z.string().optional(),
    profile: z.string().optional(),
    command: z.string().optional(),
    enabled: z.boolean().optional(),
    sandbox_mode: z.enum(["read-only", "workspace-write", "danger-full-access"]).optional(),
    success_mode: z.enum(["review", "complete"]).optional(),
    max_concurrent_runs: z.number().int().positive().optional(),
    allowed_risk: z.array(z.enum(["low", "medium", "high"])).optional(),
    allowed_repos: z.array(z.string()).optional(),
    capabilities: z.array(z.string()).optional(),
  })
  .strict();

export function agentsRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/agents", (c) => {
    const workspace = c.get("workspace");
    const agents = listAgents(workspace.backlogDir);
    const runs = listActiveRuns(workspace.backlogDir);
    const summary = agents.map((agent) => {
      const activeRuns = runs.filter((run) => run.agent_id === agent.id);
      // Surface "is this agent ready to run?" alongside the config.
      // The UI uses these flags to grey out toggle / show inline hints
      // — we don't auto-disable in storage so the user's choice is
      // preserved if they later add the missing key.
      const secretKey = requiredSecretKey(agent.provider);
      const needsApiKey = secretKey !== null && !hasSecret(workspace.backlogDir, secretKey);
      return {
        id: agent.id,
        provider: agent.provider,
        enabled: agent.enabled,
        max_concurrent_runs: agent.max_concurrent_runs,
        active_runs: activeRuns.length,
        capabilities: agent.capabilities,
        allowed_repos: agent.allowed_repos,
        allowed_risk: agent.allowed_risk,
        sandbox_mode: agent.sandbox_mode ?? null,
        success_mode: agent.success_mode ?? null,
        model: agent.model ?? null,
        profile: agent.profile ?? null,
        needs_api_key: needsApiKey,
        required_secret_key: secretKey,
      };
    });
    return c.json({ agents: summary });
  });

  app.post("/agents", async (c) => {
    const workspace = c.get("workspace");
    const raw = await c.req.json().catch(() => null);
    const parsed = createBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);
    }
    try {
      const created = addAgent(workspace.backlogDir, {
        id: parsed.data.id,
        provider: parsed.data.provider,
        ...(parsed.data.model !== undefined ? { model: parsed.data.model } : {}),
        ...(parsed.data.profile !== undefined ? { profile: parsed.data.profile } : {}),
        ...(parsed.data.command !== undefined ? { command: parsed.data.command } : {}),
        ...(parsed.data.enabled !== undefined ? { enabled: parsed.data.enabled } : {}),
        ...(parsed.data.sandbox_mode !== undefined ? { sandboxMode: parsed.data.sandbox_mode } : {}),
        ...(parsed.data.success_mode !== undefined ? { successMode: parsed.data.success_mode } : {}),
        ...(parsed.data.max_concurrent_runs !== undefined ? { maxConcurrentRuns: parsed.data.max_concurrent_runs } : {}),
        ...(parsed.data.allowed_risk !== undefined ? { allowedRisk: parsed.data.allowed_risk } : {}),
        ...(parsed.data.allowed_repos !== undefined ? { allowedRepos: parsed.data.allowed_repos } : {}),
        ...(parsed.data.capabilities !== undefined ? { capabilities: parsed.data.capabilities } : {}),
      });
      return c.json({ agent: created }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message.includes("already exists") ? 409 : 400;
      return c.json({ error: "create_failed", detail: message }, status);
    }
  });

  app.delete("/agents/:id", (c) => {
    const workspace = c.get("workspace");
    try {
      deleteAgent(workspace.backlogDir, c.req.param("id"));
      return c.body(null, 204);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message.startsWith("Unknown") ? 404 : 409;
      return c.json({ error: "delete_failed", detail: message }, status);
    }
  });

  app.patch("/agents/:id", async (c) => {
    const workspace = c.get("workspace");
    const raw = await c.req.json().catch(() => null);
    const parsed = updateBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);
    }
    const input: Parameters<typeof updateAgent>[2] = {};
    if (parsed.data.enabled !== undefined) input.enabled = parsed.data.enabled;
    if (parsed.data.max_concurrent_runs !== undefined) input.maxConcurrentRuns = parsed.data.max_concurrent_runs;
    if (parsed.data.sandbox_mode === null) input.clearSandboxMode = true;
    else if (parsed.data.sandbox_mode !== undefined) input.sandboxMode = parsed.data.sandbox_mode;
    if (parsed.data.success_mode === null) input.clearSuccessMode = true;
    else if (parsed.data.success_mode !== undefined) input.successMode = parsed.data.success_mode;
    if (parsed.data.allowed_repos !== undefined) input.allowedRepos = parsed.data.allowed_repos;
    if (parsed.data.allowed_risk !== undefined) input.allowedRisk = parsed.data.allowed_risk;
    if (parsed.data.capabilities !== undefined) input.capabilities = parsed.data.capabilities;
    if (parsed.data.model === null) input.clearModel = true;
    else if (parsed.data.model !== undefined) input.model = parsed.data.model;
    if (parsed.data.profile === null) input.clearProfile = true;
    else if (parsed.data.profile !== undefined) input.profile = parsed.data.profile;

    try {
      const agent = updateAgent(workspace.backlogDir, c.req.param("id"), input);
      return c.json({ agent });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message.startsWith("Unknown") ? 404 : 400;
      return c.json({ error: "update_failed", detail: message }, status);
    }
  });

  return app;
}
