import { z } from "zod";

export const projectRegistryEntrySchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  name: z.string().min(1),
  added_at: z.string().datetime(),
  last_opened_at: z.string().datetime().optional(),
});

export const projectRegistrySchema = z.object({
  version: z.number().int().positive(),
  projects: z.array(projectRegistryEntrySchema).default([]),
});

export type ProjectRegistryEntry = z.infer<typeof projectRegistryEntrySchema>;
export type ProjectRegistry = z.infer<typeof projectRegistrySchema>;
