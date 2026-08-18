import { z } from "zod";

export const repositoryLocationSchema = z.enum(["local", "remote"]);
export const repositoryRemoteTypeSchema = z.enum(["git", "ftp", "sftp", "other"]);
export const repositoryRemoteProviderSchema = z.enum(["github", "gitlab", "bitbucket", "custom", "other"]);
export const repoProviderSchema = z.enum(["local", "github", "gitlab", "bitbucket", "other"]);

// What an agent run is allowed to do against this repo.
//   read-write — full access (default; matches existing behaviour)
//   read-only  — agent can read files, run shell, inspect git, but can't
//                edit or commit.
//   no-access  — repo is hidden from the orchestrator; effectively
//                equivalent to enabled=false but lets you keep the
//                repo registered (e.g. for browsing) without exposing
//                it to runs. Plans never assign tasks against it.
export const repoAccessModeSchema = z.enum(["read-write", "read-only", "no-access"]);

export const repoConfigSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1).optional(),
  checkout_path: z.string().min(1).optional(),
  default_branch: z.string().min(1),
  role: z.string().optional(),
  enabled: z.boolean().default(true),
  // Access policy for agent runs on this repo. Optional so existing
  // config.toml files load unchanged; treat missing as "read-write" at
  // every read site (the runtime helpers default explicitly).
  access_mode: repoAccessModeSchema.optional(),
  location: repositoryLocationSchema.default("local"),
  remote_type: repositoryRemoteTypeSchema.optional(),
  remote_provider: repositoryRemoteProviderSchema.optional(),
  remote_url: z.string().optional(),
  // Deprecated compatibility fields. New code should use
  // location/remote_type/remote_provider/remote_url so non-Git remote
  // repositories can be represented cleanly.
  git_url: z.string().optional(),
  provider: repoProviderSchema.optional(),
}).refine(
  (repo) => (repo.location ?? "local") === "remote" || Boolean(repo.checkout_path ?? repo.path),
  { message: "Local repositories require a checkout_path or legacy path." },
);

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
  // What to do on `runs approve`. Default is fast-forward so the
  // Desktop flow means what users expect: approve/apply makes the
  // agent's commit land in the main checkout, while still refusing
  // dirty trees or conflicts.
  merge_strategy: gitMergeStrategySchema.default("fast_forward"),
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
  // Superseded by the provider registry: which runtime answers a prompt is now
  // decided from the task's preferred agents and what is actually configured.
  // Kept so existing config.toml files keep parsing; nothing reads it.
  ai_provider: aiProviderSchema.default("anthropic"),
  claims: z.object({
    ttl_minutes: z.number().int().positive(),
    enforce_on_commit: z.boolean(),
    // When true, the pre-commit hook auto-creates a claim from the
    // staged paths + branch name if no claim is currently active for
    // the committed repo, instead of blocking the commit. Keeps the
    // "every commit is tracked" invariant without forcing the user to
    // run `backlog claim start` by hand. Defaults to true so new
    // workspaces don't friction-bomb the user; existing workspaces
    // pick up the same default on next config load (Zod default).
    auto_claim_on_commit: z.boolean().default(true),
  }),
  // Optional + defaulted: existing config.toml files without a [git]
  // section get the safe defaults (no auto-merge, cleanup on approve).
  git: gitConfigSchema.default({
    branch_strategy: "isolated_worktree",
    merge_strategy: "fast_forward",
    cleanup_worktree_on_approve: true,
    delete_branch_after_merge: true,
  }),
  board: z.object({
    show_backlog_column: z.boolean().default(true),
  }).default({
    show_backlog_column: true,
  }),
  // Review-mode policy. Only relevant when an agent's success_mode is
  // "review" (the run terminates in awaiting_review instead of
  // completing). When auto_reviewer_agent_id is set, the orchestrator
  // dispatches a follow-up read-only review run using that agent
  // before the human is asked to approve. The reviewer leaves a
  // recommendation (approve / request changes + notes) visible in the
  // run inspector. Empty string = manual review only.
  review: z.object({
    show_review_column: z.boolean().default(false),
    auto_reviewer_agent_id: z.string().optional(),
  }).default({
    show_review_column: false,
  }),
  repos: z.array(repoConfigSchema).default([]),
});

export type RepositoryLocation = z.infer<typeof repositoryLocationSchema>;
export type RepositoryRemoteType = z.infer<typeof repositoryRemoteTypeSchema>;
export type RepositoryRemoteProvider = z.infer<typeof repositoryRemoteProviderSchema>;
type ParsedRepoConfig = z.infer<typeof repoConfigSchema>;
export type RepoConfig = Omit<ParsedRepoConfig, "location"> & {
  location?: RepositoryLocation;
};
export type RepoProvider = z.infer<typeof repoProviderSchema>;
export type RepoAccessMode = z.infer<typeof repoAccessModeSchema>;
export type AiProvider = z.infer<typeof aiProviderSchema>;
export type ProjectLocation = z.infer<typeof projectLocationSchema>;
export type GitMergeStrategy = z.infer<typeof gitMergeStrategySchema>;
export type GitConfig = z.infer<typeof gitConfigSchema>;
type ParsedProjectConfig = z.infer<typeof projectConfigSchema>;
export type ProjectConfig = Omit<ParsedProjectConfig, "repos"> & {
  repos: RepoConfig[];
};

export function repoCheckoutPath(repo: RepoConfig): string | undefined {
  return repo.checkout_path ?? repo.path;
}

export function repoHasLocalCheckout(repo: RepoConfig): boolean {
  return Boolean(repoCheckoutPath(repo));
}
