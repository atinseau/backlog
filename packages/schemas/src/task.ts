import { z } from "zod";

export const taskStatusSchema = z.enum([
  "backlog",
  "ready",
  "in_progress",
  "review",
  "test",
  "released",
  "done",
  "blocked",
]);

export const workPrioritySchema = z.enum(["P0", "P1", "P2", "P3"]);

export const sourceLinkSchema = z.object({
  kind: z.enum([
    "jira",
    "github",
    "notion",
    "trello",
    "asana",
    "google_sheets",
    "excel",
    "csv",
    "markdown",
    "local",
  ]),
  source_ref: z.string().optional(),
  external_id: z.string().min(1),
  url: z.string().optional(),
});

export const taskSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  source_links: z.array(sourceLinkSchema).default([]),
  status: taskStatusSchema,
  priority: workPrioritySchema,
  labels: z.array(z.string()).default([]),
  repo_targets: z.array(z.string()).default([]),
  acceptance_criteria: z.array(z.string()).default([]),
  dependencies: z.array(z.string()).default([]),
  rank: z.number().int().optional(),
  estimated_duration_seconds: z.number().int().positive().optional(),
  planning: z.object({
    split_status: z.enum(["pending", "done"]).default("pending"),
    risk: z.enum(["low", "medium", "high"]).default("medium"),
    preferred_lane: z.string().optional(),
  }),
  // Per-task execution preferences applied to the run when this task is
  // launched. Inherited by sub-tasks (auto-shim or split) unless the
  // sub-task overrides them. Optional + defaulted so existing tasks
  // load without migration.
  execution_defaults: z.object({
    manual_approval_required: z.boolean().default(false),
    // Auto-commit any changes the agent leaves in the worktree right
    // after the executor finishes. Off → the agent's edits stay
    // uncommitted and get torn down with the worktree on approve, so
    // the work is lost. Defaulted to true.
    auto_commit: z.boolean().default(true),
    // Push the run's branch to `origin` after auto-commit. Skipped
    // silently when the repo has no `origin` remote (local-only).
    // Defaulted to true so collaborators can pull the work without
    // an extra step.
    push_when_done: z.boolean().default(true),
    // After the push, open a pull request via `gh pr create` (or the
    // host's equivalent). Off by default — depends on the gh CLI
    // being installed and authenticated. The post-run hook logs a
    // friendly skip event when prerequisites are missing.
    create_pr: z.boolean().default(false),
    // Auto-merge the PR after creation. Only honoured when create_pr
    // is also true; off by default so the human reviews before the
    // merge button is clicked.
    merge_pr: z.boolean().default(false),
    // Where the agent does its work:
    //   direct (default)            — work directly in the user's
    //                                 main checkout. Matches what
    //                                 most users expect for a single
    //                                 quick task.
    //   isolated_worktree           — safe, parallel-friendly. Use
    //                                 when running multiple agents
    //                                 simultaneously or when you
    //                                 don't want the agent touching
    //                                 your working copy at all.
    worktree_mode: z.enum(["isolated_worktree", "direct"]).default("direct"),
    // Default assignee for sub-tasks generated from this task. Empty
    // means "let the orchestrator pick" (auto). A single id picks a
    // specific agent (claude-code, codex, etc.) or a user. The
    // sub-task can still override per-row.
    preferred_agents: z.array(z.string()).default([]),
    // Per-task cap for parallel split execution. The planner may
    // produce fewer chunks, but it should not run more than this many
    // agent processes for the task at once.
    max_subagents: z.number().int().min(1).max(99).default(5),
  }).default({
    manual_approval_required: false,
    auto_commit: true,
    push_when_done: true,
    create_pr: false,
    merge_pr: false,
    worktree_mode: "direct",
    preferred_agents: [],
    max_subagents: 5,
  }),
  sync: z.object({
    source_of_truth: z.enum(["external", "backlog"]).default("backlog"),
    push_status: z.boolean().default(false),
    push_comments: z.boolean().default(false),
  }).default({
    source_of_truth: "backlog",
    push_status: false,
    push_comments: false,
  }),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
  // ISO timestamp set by `backlog task archive`. When present, the
  // task is hidden from default board / list views (use --archived
  // or --all to see it). Distinct from status — archive is orthogonal
  // to "what's the work doing right now". Unarchive clears the field
  // and the task reappears in its original status.
  archived_at: z.string().min(1).optional(),
});

export const tasksFileSchema = z.object({
  version: z.literal(1),
  tasks: z.array(taskSchema).default([]),
});

export type SourceLink = z.infer<typeof sourceLinkSchema>;
export type Task = z.infer<typeof taskSchema>;
export type TasksFile = z.infer<typeof tasksFileSchema>;
export type TaskStatus = z.infer<typeof taskStatusSchema>;
