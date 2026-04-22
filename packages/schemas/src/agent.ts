import { z } from "zod";

export const agentSchema = z.object({
  id: z.string().min(1),
  provider: z.string().min(1),
  model: z.string().optional(),
  profile: z.string().optional(),
  command: z.string().optional(),
  sandbox_mode: z.enum(["read-only", "workspace-write", "danger-full-access"]).optional(),
  success_mode: z.enum(["review", "complete"]).optional(),
  environment: z.record(z.string(), z.string()).default({}),
  enabled: z.boolean().default(true),
  max_concurrent_runs: z.number().int().positive().default(1),
  allowed_repos: z.array(z.string()).default([]),
  allowed_risk: z.array(z.enum(["low", "medium", "high"])).default(["low", "medium"]),
  capabilities: z.array(z.string()).default([]),
});

export const agentsFileSchema = z.object({
  version: z.literal(1),
  agents: z.array(agentSchema).default([]),
});

export type Agent = z.infer<typeof agentSchema>;
export type AgentsFile = z.infer<typeof agentsFileSchema>;
