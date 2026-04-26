import { z } from "zod";

export const claimRecordSchema = z.object({
  version: z.literal(1),
  id: z.string().min(1),
  repo: z.string().min(1),
  repo_path: z.string().min(1),
  paths: z.array(z.string().min(1)).min(1),
  mode: z.enum(["exclusive", "shared"]),
  status: z.enum(["active", "archived"]),
  topic: z.string().min(1),
  created_at: z.string().min(1),
  heartbeat_at: z.string().min(1),
  expires_at: z.string().min(1),
  finished_at: z.string().min(1).optional(),
  expected_duration_seconds: z.number().int().positive().optional(),
  expected_finish_at: z.string().min(1).optional(),
  agent_id: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.string()).optional(),
});

export const backlogContextSchema = z.object({
  version: z.literal(1),
  claim_id: z.string().min(1),
  updated_at: z.string().min(1),
});

export type ClaimRecord = z.infer<typeof claimRecordSchema>;
export type BacklogContext = z.infer<typeof backlogContextSchema>;
