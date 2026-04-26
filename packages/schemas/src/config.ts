import { z } from "zod";

export const repoProviderSchema = z.enum(["local", "github", "gitlab", "bitbucket", "other"]);

export const repoConfigSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  default_branch: z.string().min(1),
  role: z.string().optional(),
  enabled: z.boolean().default(true),
  git_url: z.string().optional(),
  provider: repoProviderSchema.optional(),
});

export const workspaceConfigSchema = z.object({
  version: z.number().int().positive(),
  workspace_name: z.string().min(1),
  workspace_mode: z.enum(["embedded", "control_plane"]),
  default_branch: z.string().min(1),
  autonomy_mode: z.enum(["observe", "assist", "delegate", "autopilot"]),
  max_agents: z.number().int().positive(),
  claims: z.object({
    ttl_minutes: z.number().int().positive(),
    enforce_on_commit: z.boolean(),
  }),
  repos: z.array(repoConfigSchema).default([]),
});

export type RepoConfig = z.infer<typeof repoConfigSchema>;
export type RepoProvider = z.infer<typeof repoProviderSchema>;
export type WorkspaceConfig = z.infer<typeof workspaceConfigSchema>;
