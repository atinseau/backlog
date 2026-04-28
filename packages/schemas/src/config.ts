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

// What to do with the run branch once a run is approved.
//   none           — leave the branch + worktree alone, the user merges by hand
//   fast_forward   — `git merge --ff-only` into merge_target. Fails (and
//                    reports) if the target moved, so we never auto-create
//                    merge commits in this mode.
//   merge_commit   — `git merge --no-ff` always creating a merge commit
export const gitMergeStrategySchema = z.enum(["none", "fast_forward", "merge_commit"]);

export const gitConfigSchema = z.object({
  // Each run gets its own isolated git worktree on a `backlog/<id>-…`
  // branch. There's no other layout today, but the field exists so we
  // can add a `direct` (work in the main checkout) mode later without
  // a config-shape break. Stays "isolated_worktree" by default — direct
  // mode is risky for multi-agent parallelism.
  branch_strategy: z.enum(["isolated_worktree"]).default("isolated_worktree"),
  // What to do on `runs approve`. Default is "none" so existing
  // workspaces keep their current "approve = mark-complete only,
  // user merges by hand" behaviour.
  merge_strategy: gitMergeStrategySchema.default("none"),
  // Branch to merge into when merge_strategy != "none". Falls back to
  // the repo's default_branch if unset.
  merge_target: z.string().min(1).optional(),
  // After approve (and merge if applicable), tear down the worktree
  // so the branch isn't held hostage for `git switch`. Matches the
  // most common user expectation: "approved = done, the isolated
  // copy can go". Set to false if you want to inspect worktrees by
  // hand.
  cleanup_worktree_on_approve: z.boolean().default(true),
  // After a successful merge, delete the run branch. Only fires when
  // merge actually succeeds — never deletes unmerged work.
  delete_branch_after_merge: z.boolean().default(true),
});

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
  // Optional + defaulted: existing config.toml files without a [git]
  // section get the safe defaults (no auto-merge, cleanup on approve).
  git: gitConfigSchema.default({
    branch_strategy: "isolated_worktree",
    merge_strategy: "none",
    cleanup_worktree_on_approve: true,
    delete_branch_after_merge: true,
  }),
  repos: z.array(repoConfigSchema).default([]),
});

export type RepoConfig = z.infer<typeof repoConfigSchema>;
export type RepoProvider = z.infer<typeof repoProviderSchema>;
export type AiProvider = z.infer<typeof aiProviderSchema>;
export type ProjectLocation = z.infer<typeof projectLocationSchema>;
export type GitMergeStrategy = z.infer<typeof gitMergeStrategySchema>;
export type GitConfig = z.infer<typeof gitConfigSchema>;
export type ProjectConfig = z.infer<typeof projectConfigSchema>;
