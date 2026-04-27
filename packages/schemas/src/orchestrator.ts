import { z } from "zod";

export const orchestratorModeSchema = z.enum(["idle", "running", "paused", "stopping"]);

export const orchestratorStateSchema = z.object({
  version: z.literal(1),
  mode: orchestratorModeSchema.default("idle"),
  max_agents: z.number().int().positive().default(3),
  auto_pick_agents: z.boolean().default(true),
  tick_interval_ms: z.number().int().positive().default(5000),
  started_at: z.string().optional(),
  paused_at: z.string().optional(),
  last_tick_at: z.string().optional(),
  last_started_count: z.number().int().nonnegative().optional(),
  last_error: z.string().optional(),
});

export type OrchestratorMode = z.infer<typeof orchestratorModeSchema>;
export type OrchestratorState = z.infer<typeof orchestratorStateSchema>;

export const defaultOrchestratorState = (): OrchestratorState => ({
  version: 1,
  mode: "idle",
  max_agents: 3,
  auto_pick_agents: true,
  tick_interval_ms: 5000,
});
