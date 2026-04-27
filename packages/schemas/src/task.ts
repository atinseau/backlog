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
});

export const tasksFileSchema = z.object({
  version: z.literal(1),
  tasks: z.array(taskSchema).default([]),
});

export type SourceLink = z.infer<typeof sourceLinkSchema>;
export type Task = z.infer<typeof taskSchema>;
export type TasksFile = z.infer<typeof tasksFileSchema>;
export type TaskStatus = z.infer<typeof taskStatusSchema>;
