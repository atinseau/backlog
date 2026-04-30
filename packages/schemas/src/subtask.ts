import { z } from "zod";

export const subTaskStatusSchema = z.enum([
  "queued",
  "planned",
  "running",
  "waiting",
  "review",
  "completed",
  "blocked",
  "canceled",
]);

export const subTaskSchema = z.object({
  id: z.string().min(1),
  task_id: z.string().min(1),
  title: z.string().min(1),
  repo: z.string().min(1),
  status: subTaskStatusSchema,
  priority_score: z.number().int().default(50),
  risk: z.enum(["low", "medium", "high"]).default("medium"),
  scopes: z.array(z.string()).default([]),
  claim_mode: z.enum(["exclusive", "shared"]).default("exclusive"),
  depends_on: z.array(z.string()).default([]),
  blockers: z.array(z.string()).default([]),
  estimated_duration_seconds: z.number().int().positive().optional(),
  estimate_source: z.enum(["manual", "auto"]).optional(),
  progress_percent: z.number().int().min(0).max(100).optional(),
  execution: z.object({
    lane: z.string().optional(),
    preferred_agents: z.array(z.string()).default([]),
    required_capabilities: z.array(z.string()).default([]),
    manual_approval_required: z.boolean().default(false),
  }).default({
    preferred_agents: [],
    required_capabilities: [],
    manual_approval_required: false,
  }),
  completion: z.object({
    done_when: z.array(z.string()).default([]),
  }).default({
    done_when: [],
  }),
  planner: z.object({
    origin: z.enum(["manual", "split", "imported"]).default("manual"),
    locked: z.boolean().default(false),
    last_planned_at: z.string().optional(),
  }).default({
    origin: "manual",
    locked: false,
  }),
  created_at: z.string().min(1),
  updated_at: z.string().min(1),
  // ISO timestamp set by `backlog subtask archive`. When present the
  // sub-task is hidden from default views; the scheduler also skips
  // it. Unarchive clears the field. Orthogonal to status.
  archived_at: z.string().min(1).optional(),
});

export const subTasksFileSchema = z.object({
  version: z.literal(1),
  subtasks: z.array(subTaskSchema).default([]),
});

export type SubTask = z.infer<typeof subTaskSchema>;
export type SubTasksFile = z.infer<typeof subTasksFileSchema>;
export type SubTaskStatus = z.infer<typeof subTaskStatusSchema>;
