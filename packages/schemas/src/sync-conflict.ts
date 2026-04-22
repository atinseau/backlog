import { z } from "zod";

export const syncConflictSchema = z.object({
  id: z.string().min(1),
  work_item_id: z.string().min(1),
  source_ref: z.string().min(1),
  field: z.literal("status"),
  local_value: z.string().min(1),
  external_value: z.string().min(1),
  resolution: z.enum(["pending", "external", "local"]).default("pending"),
  detected_at: z.string().min(1),
  resolved_at: z.string().optional(),
});

export const syncConflictsFileSchema = z.object({
  version: z.literal(1),
  conflicts: z.array(syncConflictSchema).default([]),
});

export type SyncConflict = z.infer<typeof syncConflictSchema>;
export type SyncConflictsFile = z.infer<typeof syncConflictsFileSchema>;
