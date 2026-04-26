import { z } from "zod";

export const projectSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9][a-z0-9-]*$/, "slug must be lowercase alphanumeric with dashes"),
  name: z.string().min(1),
  description: z.string().optional(),
  color: z.string().optional(),
  repo_ids: z.array(z.string()).default([]),
  max_agents: z.number().int().positive().optional(),
  archived: z.boolean().default(false),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
});

export const projectsFileSchema = z.object({
  version: z.literal(1),
  projects: z.array(projectSchema).default([]),
});

export type Project = z.infer<typeof projectSchema>;
export type ProjectsFile = z.infer<typeof projectsFileSchema>;
