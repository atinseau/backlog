import { z } from "zod";

export const workStatusSchema = z.enum([
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

export const workItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  source_links: z.array(sourceLinkSchema).default([]),
  status: workStatusSchema,
  priority: workPrioritySchema,
  labels: z.array(z.string()).default([]),
  repo_targets: z.array(z.string()).default([]),
  acceptance_criteria: z.array(z.string()).default([]),
  dependencies: z.array(z.string()).default([]),
  planning: z.object({
    split_status: z.enum(["pending", "done"]).default("pending"),
    risk: z.enum(["low", "medium", "high"]).default("medium"),
    preferred_lane: z.string().optional(),
  }),
  sync: z.object({
    source_of_truth: z.enum(["external", "cockpit"]).default("cockpit"),
    push_status: z.boolean().default(false),
    push_comments: z.boolean().default(false),
  }).default({
    source_of_truth: "cockpit",
    push_status: false,
    push_comments: false,
  }),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
});

export const workItemsFileSchema = z.object({
  version: z.literal(1),
  items: z.array(workItemSchema).default([]),
});

export type SourceLink = z.infer<typeof sourceLinkSchema>;
export type WorkItem = z.infer<typeof workItemSchema>;
export type WorkItemsFile = z.infer<typeof workItemsFileSchema>;
export type WorkStatus = z.infer<typeof workStatusSchema>;
