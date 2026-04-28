import { z } from "zod";
import { projectLocationSchema } from "./config.js";

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
});

export const projectRegistrySchema = z.object({
  version: z.number().int().positive(),
  projects: z.array(projectRegistryEntrySchema).default([]),
});

export type ProjectRegistryEntry = z.infer<typeof projectRegistryEntrySchema>;
export type ProjectRegistry = z.infer<typeof projectRegistrySchema>;
