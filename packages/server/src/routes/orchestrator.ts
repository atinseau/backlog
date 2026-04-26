import {
  getOrchestratorState,
  pauseOrchestrator,
  setOrchestratorConfig,
  startOrchestrator,
  stopOrchestrator,
} from "@backlog/core";
import { Hono } from "hono";
import { z } from "zod";
import type { ServerWorkspace } from "../workspace-context.js";

const startBodySchema = z
  .object({
    max_agents: z.number().int().positive().optional(),
    auto_pick_agents: z.boolean().optional(),
    tick_interval_ms: z.number().int().positive().optional(),
    project_id: z.string().optional(),
  })
  .strict();

const configBodySchema = z
  .object({
    max_agents: z.number().int().positive().optional(),
    auto_pick_agents: z.boolean().optional(),
    tick_interval_ms: z.number().int().positive().optional(),
  })
  .strict();

export function orchestratorRoutes(workspace: ServerWorkspace): Hono {
  const app = new Hono();

  app.get("/orchestrator/state", (c) => {
    return c.json({ state: getOrchestratorState(workspace.backlogDir) });
  });

  app.post("/orchestrator/start", async (c) => {
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
      if (parsed.data.project_id !== undefined) input.project_id = parsed.data.project_id;
      const state = await startOrchestrator(workspace.backlogDir, input);
      return c.json({ state });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "start_failed", detail: message }, 500);
    }
  });

  app.post("/orchestrator/pause", (c) => {
    return c.json({ state: pauseOrchestrator(workspace.backlogDir) });
  });

  app.post("/orchestrator/stop", async (c) => {
    try {
      const state = await stopOrchestrator(workspace.backlogDir);
      return c.json({ state });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "stop_failed", detail: message }, 500);
    }
  });

  app.patch("/orchestrator/config", async (c) => {
    const raw = await c.req.json().catch(() => null);
    const parsed = configBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);
    }
    const input: Parameters<typeof setOrchestratorConfig>[1] = {};
    if (parsed.data.max_agents !== undefined) input.max_agents = parsed.data.max_agents;
    if (parsed.data.auto_pick_agents !== undefined) input.auto_pick_agents = parsed.data.auto_pick_agents;
    if (parsed.data.tick_interval_ms !== undefined) input.tick_interval_ms = parsed.data.tick_interval_ms;
    return c.json({ state: setOrchestratorConfig(workspace.backlogDir, input) });
  });

  return app;
}
