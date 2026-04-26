import { z } from "zod";

export const workspaceRegistryEntrySchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  name: z.string().min(1),
  added_at: z.string().datetime(),
  last_opened_at: z.string().datetime().optional(),
});

export const workspaceRegistrySchema = z.object({
  version: z.number().int().positive(),
  workspaces: z.array(workspaceRegistryEntrySchema).default([]),
});

export type WorkspaceRegistryEntry = z.infer<typeof workspaceRegistryEntrySchema>;
export type WorkspaceRegistry = z.infer<typeof workspaceRegistrySchema>;
