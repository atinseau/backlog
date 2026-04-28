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

export const aiProviderSchema = z.enum(["anthropic", "openai", "codex"]);

// Where the workspace data lives on disk:
//   in_repo    — <project root>/.backlog/ (default; suits a single repo)
//   user_level — ~/.backlog/<project_name>/ (suits multi-repo projects)
export const projectLocationSchema = z.enum(["in_repo", "user_level"]);

export const projectConfigSchema = z.object({
  version: z.number().int().positive(),
  project_id: z.string().min(1).optional(),
  project_name: z.string().min(1),
  project_mode: z.enum(["embedded", "control_plane"]),
  // Optional + defaulted so existing TOML files keep loading unchanged.
  project_location: projectLocationSchema.default("in_repo"),
  default_branch: z.string().min(1),
  autonomy_mode: z.enum(["observe", "assist", "delegate", "autopilot"]),
  max_agents: z.number().int().positive(),
  ai_provider: aiProviderSchema.default("anthropic"),
  claims: z.object({
    ttl_minutes: z.number().int().positive(),
    enforce_on_commit: z.boolean(),
  }),
  repos: z.array(repoConfigSchema).default([]),
});

export type RepoConfig = z.infer<typeof repoConfigSchema>;
export type RepoProvider = z.infer<typeof repoProviderSchema>;
export type AiProvider = z.infer<typeof aiProviderSchema>;
export type ProjectLocation = z.infer<typeof projectLocationSchema>;
export type ProjectConfig = z.infer<typeof projectConfigSchema>;
