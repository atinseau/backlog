import { z } from "zod";
import { projectLocationSchema } from "./config.js";

// One snapshot in the migration history for a project. We push a record
// every time `backlog project migrate` succeeds so `migrate-rollback` knows
// what to restore (the new path is `path` on the entry; the previous one
// would otherwise be lost).
export const projectMigrationRecordSchema = z.object({
  // Where the workspace lived before this migration. Same shape as
  // ProjectRegistryEntry.path (project root for in_repo, workspace dir
  // for user_level).
  previous_path: z.string().min(1),
  previous_location: projectLocationSchema,
  // Path to the archived workspace dir (`.migrated-YYYY-MM-DD/`). Empty
  // when --keep-old was passed and nothing was archived.
  archived_at: z.string().min(1).optional(),
  migrated_at: z.string().datetime(),
});

export const projectRegistryEntrySchema = z.object({
  id: z.string().min(1),
  // For in_repo projects: the project root that contains .backlog/.
  // For user_level projects: the workspace dir itself (e.g. ~/.backlog/<name>/);
  // there is no inner .backlog/ subdirectory in that case.
  path: z.string().min(1),
  name: z.string().min(1),
  added_at: z.string().datetime(),
  last_opened_at: z.string().datetime().optional(),
  // Optional + defaulted so existing registry entries keep loading unchanged.
  location: projectLocationSchema.default("in_repo"),
  // History of moves applied to this project, oldest first. `migrate-rollback`
  // pops the last record. Optional so old registries don't fail to parse.
  migration_history: z.array(projectMigrationRecordSchema).default([]),
});

export const projectRegistrySchema = z.object({
  version: z.number().int().positive(),
  projects: z.array(projectRegistryEntrySchema).default([]),
});

export type ProjectMigrationRecord = z.infer<typeof projectMigrationRecordSchema>;
export type ProjectRegistryEntry = z.infer<typeof projectRegistryEntrySchema>;
export type ProjectRegistry = z.infer<typeof projectRegistrySchema>;
