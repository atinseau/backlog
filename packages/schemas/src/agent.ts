import { z } from "zod";

// What to do when an agent run fails before review. `none` is the
// historical behaviour: the run goes into `failed` immediately and a
// human steps in. `feedback` retries up to N times with the previous
// attempt's stderr / handoff content prepended to the prompt so the
// agent can learn from its own mistake.
export const retryPolicySchema = z.object({
  mode: z.enum(["none", "feedback"]).default("none"),
  max_attempts: z.number().int().positive().max(5).default(2),
  // If true, retries reuse the same worktree (state from the failed
  // attempt is preserved). False creates a fresh worktree per retry.
  reuse_worktree: z.boolean().default(true),
});

export const agentSchema = z.object({
  id: z.string().min(1),
  // Optional human-friendly label set via the kanban (double-click on
  // the agent's name in the picker / Agents view) or
  // `backlog agents update --display-name`. When absent the UI
  // computes one from provider + model — see formatAgentLabel().
  // Persisted so the chosen name survives across sessions / machines.
  display_name: z.string().min(1).optional(),
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
  // Optional + defaulted to mode=none so existing agents.yaml files
  // keep their current behaviour.
  retry_policy: retryPolicySchema.default({ mode: "none", max_attempts: 2, reuse_worktree: true }),
});

export const agentsFileSchema = z.object({
  version: z.literal(1),
  agents: z.array(agentSchema).default([]),
});

export type RetryPolicy = z.infer<typeof retryPolicySchema>;
export type Agent = z.infer<typeof agentSchema>;
export type AgentsFile = z.infer<typeof agentsFileSchema>;
