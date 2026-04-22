import { z } from "zod";

export const taskStatusSchema = z.enum([
  "queued",
  "planned",
  "running",
  "waiting",
  "review",
  "completed",
  "blocked",
  "canceled",
]);

export const taskSchema = z.object({
  id: z.string().min(1),
  work_item_id: z.string().min(1),
  title: z.string().min(1),
  repo: z.string().min(1),
  status: taskStatusSchema,
  priority_score: z.number().int().default(50),
  risk: z.enum(["low", "medium", "high"]).default("medium"),
  scopes: z.array(z.string()).default([]),
  claim_mode: z.enum(["exclusive", "shared"]).default("exclusive"),
  depends_on: z.array(z.string()).default([]),
  blockers: z.array(z.string()).default([]),
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
});

export const tasksFileSchema = z.object({
  version: z.literal(1),
  tasks: z.array(taskSchema).default([]),
});

export type Task = z.infer<typeof taskSchema>;
export type TasksFile = z.infer<typeof tasksFileSchema>;
export type TaskStatus = z.infer<typeof taskStatusSchema>;
