import { listActiveRuns, listAgents, updateAgent } from "@backlog/core";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../project-resolver.js";

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

export function agentsRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/agents", (c) => {
    const workspace = c.get("workspace");
    const agents = listAgents(workspace.backlogDir);
    const runs = listActiveRuns(workspace.backlogDir);
    const summary = agents.map((agent) => {
      const activeRuns = runs.filter((run) => run.agent_id === agent.id);
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
      };
    });
    return c.json({ agents: summary });
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
