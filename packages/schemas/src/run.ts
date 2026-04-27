import { z } from "zod";

export const runStatusSchema = z.enum([
  "queued",
  "preparing",
  "running",
  "awaiting_review",
  "succeeded",
  "failed",
  "blocked",
  "interrupted",
  "canceled",
]);

export const artifactSchema = z.object({
  kind: z.enum(["branch", "commit", "patch", "pr", "test_report", "summary", "file", "log"]),
  value: z.string().min(1),
});

export const runSchema = z.object({
  version: z.literal(1),
  id: z.string().min(1),
  subtask_id: z.string().min(1),
  task_id: z.string().min(1),
  repo: z.string().min(1),
  branch: z.string().min(1),
  agent_id: z.string().min(1),
  provider: z.string().min(1),
  status: runStatusSchema,
  claim_ids: z.array(z.string()).default([]),
  worktree_path: z.string().min(1),
  artifacts: z.array(artifactSchema).default([]),
  result: z.string().nullable().default(null),
  started_at: z.string().optional(),
  finished_at: z.string().optional(),
});

export type Artifact = z.infer<typeof artifactSchema>;
export type Run = z.infer<typeof runSchema>;
