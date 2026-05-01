import {
  getOrchestratorState,
  pauseOrchestrator,
  setOrchestratorConfig,
  startOrchestrator,
  stopOrchestrator,
} from "@backlog/core";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../project-resolver.js";

const startBodySchema = z
  .object({
    max_agents: z.number().int().positive().optional(),
    auto_pick_agents: z.boolean().optional(),
    tick_interval_ms: z.number().int().positive().optional(),
  })
  .strict();

const configBodySchema = z
  .object({
    max_agents: z.number().int().positive().optional(),
    auto_pick_agents: z.boolean().optional(),
    tick_interval_ms: z.number().int().positive().optional(),
  })
  .strict();

export function orchestratorRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/orchestrator/state", (c) => {
    const project = c.get("project");
    return c.json({ state: getOrchestratorState(project.backlogDir) });
  });

  app.post("/orchestrator/start", async (c) => {
    const project = c.get("project");
    const raw = await c.req.json().catch(() => ({}));
    const parsed = startBodySchema.safeParse(raw ?? {});
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);
    }
    try {
      const input: Parameters<typeof startOrchestrator>[1] = {};
      if (parsed.data.max_agents !== undefined) input.max_agents = parsed.data.max_agents;
      if (parsed.data.auto_pick_agents !== undefined) input.auto_pick_agents = parsed.data.auto_pick_agents;
      if (parsed.data.tick_interval_ms !== undefined) input.tick_interval_ms = parsed.data.tick_interval_ms;
      const state = await startOrchestrator(project.backlogDir, input);
      return c.json({ state });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "start_failed", detail: message }, 500);
    }
  });

  app.post("/orchestrator/pause", (c) => {
    const project = c.get("project");
    return c.json({ state: pauseOrchestrator(project.backlogDir) });
  });

  app.post("/orchestrator/stop", async (c) => {
    const project = c.get("project");
    try {
      const state = await stopOrchestrator(project.backlogDir);
      return c.json({ state });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "stop_failed", detail: message }, 500);
    }
  });

  app.patch("/orchestrator/config", async (c) => {
    const project = c.get("project");
    const raw = await c.req.json().catch(() => null);
    const parsed = configBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);
    }
    const input: Parameters<typeof setOrchestratorConfig>[1] = {};
    if (parsed.data.max_agents !== undefined) input.max_agents = parsed.data.max_agents;
    if (parsed.data.auto_pick_agents !== undefined) input.auto_pick_agents = parsed.data.auto_pick_agents;
    if (parsed.data.tick_interval_ms !== undefined) input.tick_interval_ms = parsed.data.tick_interval_ms;
    return c.json({ state: setOrchestratorConfig(project.backlogDir, input) });
  });

  return app;
}
