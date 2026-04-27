import {
  clearSubTaskEstimate,
  createSubTask,
  reorderSubTask,
  setSubTaskEstimate,
  setSubTaskProgress,
  updateSubTaskStatus,
} from "@backlog/core";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../project-resolver.js";

const moveBodySchema = z.object({
  to: z.enum([
    "queued",
    "planned",
    "running",
    "waiting",
    "review",
    "completed",
    "blocked",
    "canceled",
  ]),
});

const createBodySchema = z.object({
  task_id: z.string().min(1),
  title: z.string().min(1),
  repo: z.string().min(1),
  scopes: z.array(z.string().min(1)).optional(),
  depends_on: z.array(z.string().min(1)).optional(),
  blockers: z.array(z.string().min(1)).optional(),
  risk: z.enum(["low", "medium", "high"]).optional(),
  priority_score: z.number().int().optional(),
  claim_mode: z.enum(["exclusive", "shared"]).optional(),
  lane: z.string().optional(),
  preferred_agents: z.array(z.string()).optional(),
  required_capabilities: z.array(z.string()).optional(),
  manual_approval_required: z.boolean().optional(),
});

const reorderBodySchema = z
  .object({
    before_id: z.string().min(1).optional(),
    after_id: z.string().min(1).optional(),
  })
  .refine(
    (data) => Boolean(data.before_id) !== Boolean(data.after_id) || (!data.before_id && !data.after_id),
    "provide before_id or after_id, not both",
  );

const estimateBodySchema = z
  .object({
    seconds: z.number().int().positive().nullable(),
    source: z.enum(["manual", "auto"]).optional(),
  })
  .strict();

const progressBodySchema = z.object({
  percent: z.number().min(0).max(100),
});

export function subtasksRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/subtasks", async (c) => {
    const workspace = c.get("workspace");
    const raw = await c.req.json().catch(() => null);
    const parsed = createBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);
    }
    try {
      const input: Parameters<typeof createSubTask>[1] = {
        workItemId: parsed.data.task_id,
        title: parsed.data.title,
        repo: parsed.data.repo,
      };
      if (parsed.data.scopes !== undefined) input.scopes = parsed.data.scopes;
      if (parsed.data.depends_on !== undefined) input.dependsOn = parsed.data.depends_on;
      if (parsed.data.blockers !== undefined) input.blockers = parsed.data.blockers;
      if (parsed.data.risk !== undefined) input.risk = parsed.data.risk;
      if (parsed.data.priority_score !== undefined) input.priorityScore = parsed.data.priority_score;
      if (parsed.data.claim_mode !== undefined) input.claimMode = parsed.data.claim_mode;
      if (parsed.data.lane !== undefined) input.lane = parsed.data.lane;
      if (parsed.data.preferred_agents !== undefined) input.preferredAgents = parsed.data.preferred_agents;
      if (parsed.data.required_capabilities !== undefined) input.requiredCapabilities = parsed.data.required_capabilities;
      if (parsed.data.manual_approval_required !== undefined) input.manualApprovalRequired = parsed.data.manual_approval_required;
      const task = createSubTask(workspace.backlogDir, input);
      return c.json({ task }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message.startsWith("Unknown") ? 404 : 400;
      return c.json({ error: "create_failed", detail: message }, status);
    }
  });

  app.post("/subtasks/:id/move", async (c) => {
    const workspace = c.get("workspace");
    const id = c.req.param("id");
    const raw = await c.req.json().catch(() => null);
    const parsed = moveBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);
    }
    try {
      const updated = updateSubTaskStatus(workspace.backlogDir, id, parsed.data.to);
      return c.json({ task: updated });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "update_failed", detail: message }, 404);
    }
  });

  app.post("/subtasks/:id/reorder", async (c) => {
    const workspace = c.get("workspace");
    const id = c.req.param("id");
    const raw = await c.req.json().catch(() => ({}));
    const parsed = reorderBodySchema.safeParse(raw ?? {});
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);
    }
    try {
      const input: Parameters<typeof reorderSubTask>[1] = { taskId: id };
      if (parsed.data.before_id !== undefined) input.beforeId = parsed.data.before_id;
      if (parsed.data.after_id !== undefined) input.afterId = parsed.data.after_id;
      const task = reorderSubTask(workspace.backlogDir, input);
      return c.json({ task });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "reorder_failed", detail: message }, 404);
    }
  });

  app.patch("/subtasks/:id/estimate", async (c) => {
    const workspace = c.get("workspace");
    const id = c.req.param("id");
    const raw = await c.req.json().catch(() => null);
    const parsed = estimateBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);
    }
    try {
      const task = parsed.data.seconds === null
        ? clearSubTaskEstimate(workspace.backlogDir, id)
        : setSubTaskEstimate(workspace.backlogDir, id, parsed.data.seconds, parsed.data.source ?? "manual");
      return c.json({ task });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "estimate_failed", detail: message }, 404);
    }
  });

  app.patch("/subtasks/:id/progress", async (c) => {
    const workspace = c.get("workspace");
    const id = c.req.param("id");
    const raw = await c.req.json().catch(() => null);
    const parsed = progressBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);
    }
    try {
      const task = setSubTaskProgress(workspace.backlogDir, id, parsed.data.percent);
      return c.json({ task });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "progress_failed", detail: message }, 404);
    }
  });

  return app;
}
