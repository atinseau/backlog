import { loadConfig } from "@backlog/config";
import {
  applySplitProposal,
  createTask,
  listTasks,
  reorderTask,
  resolveSplitRepos,
  setTaskEstimate,
  splitTask,
  updateTaskStatus,
} from "@backlog/core";
import { Hono } from "hono";
import { z } from "zod";
import { AiSplitterUnavailableError, suggestSplit } from "../lib/ai-splitter.js";
import type { AppEnv } from "../project-resolver.js";

const moveBodySchema = z.object({
  to: z.enum([
    "backlog",
    "ready",
    "in_progress",
    "review",
    "test",
    "released",
    "done",
    "blocked",
  ]),
});

const createBodySchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  priority: z.enum(["P0", "P1", "P2", "P3"]).optional(),
  repo_targets: z.array(z.string().min(1)).optional(),
  labels: z.array(z.string().min(1)).optional(),
  acceptance_criteria: z.array(z.string().min(1)).optional(),
  estimated_duration_seconds: z.number().int().positive().optional(),
});

const reorderBodySchema = z.object({
  before_id: z.string().min(1).optional(),
  after_id: z.string().min(1).optional(),
});

const estimateBodySchema = z
  .object({
    seconds: z.number().int().positive().nullable(),
  })
  .strict();

const splitBodySchema = z.object({
  repos: z.array(z.string().min(1)).optional(),
  mode: z.enum(["parallel", "serial"]).default("parallel"),
  scope_by_repo: z.record(z.string(), z.array(z.string())).optional(),
  risk: z.enum(["low", "medium", "high"]).optional(),
  force: z.boolean().optional(),
});

const applySplitBodySchema = z.object({
  tasks: z
    .array(
      z.object({
        title: z.string().min(1),
        repo: z.string().min(1),
        scopes: z.array(z.string().min(1)).min(1),
        risk: z.enum(["low", "medium", "high"]),
        depends_on_indices: z.array(z.number().int().min(0)).default([]),
      }),
    )
    .min(1)
    .max(12),
  force: z.boolean().optional(),
});

export function workItemsRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/tasks", async (c) => {
    const workspace = c.get("workspace");
    const raw = await c.req.json().catch(() => null);
    const parsed = createBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);
    }
    try {
      const input: Parameters<typeof createTask>[1] = {
        title: parsed.data.title,
      };
      if (parsed.data.description !== undefined) input.description = parsed.data.description;
      if (parsed.data.priority !== undefined) input.priority = parsed.data.priority;
      if (parsed.data.repo_targets !== undefined) input.repoTargets = parsed.data.repo_targets;
      if (parsed.data.labels !== undefined) input.labels = parsed.data.labels;
      if (parsed.data.acceptance_criteria !== undefined) input.acceptanceCriteria = parsed.data.acceptance_criteria;
      let workItem = createTask(workspace.backlogDir, input);
      if (parsed.data.estimated_duration_seconds) {
        workItem = setTaskEstimate(workspace.backlogDir, workItem.id, parsed.data.estimated_duration_seconds);
      }
      return c.json({ work_item: workItem }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "create_failed", detail: message }, 400);
    }
  });

  app.post("/tasks/:id/move", async (c) => {
    const workspace = c.get("workspace");
    const id = c.req.param("id");
    const raw = await c.req.json().catch(() => null);
    const parsed = moveBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);
    }
    try {
      const updated = updateTaskStatus(workspace.backlogDir, id, parsed.data.to);
      return c.json({ work_item: updated });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "update_failed", detail: message }, 404);
    }
  });

  app.post("/tasks/:id/split", async (c) => {
    const workspace = c.get("workspace");
    const id = c.req.param("id");
    const raw = await c.req.json().catch(() => null);
    const parsed = splitBodySchema.safeParse(raw ?? {});
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);
    }
    try {
      const config = loadConfig(workspace.backlogDir);
      const workItem = listTasks(workspace.backlogDir).find((item) => item.id === id);
      if (!workItem) {
        return c.json({ error: "unknown_work_item", id }, 404);
      }
      const repos = resolveSplitRepos(config, workItem, parsed.data.repos);
      const input: Parameters<typeof splitTask>[1] = {
        workItemId: id,
        repos,
        mode: parsed.data.mode,
      };
      if (parsed.data.scope_by_repo !== undefined) input.scopeByRepo = parsed.data.scope_by_repo;
      if (parsed.data.risk !== undefined) input.risk = parsed.data.risk;
      if (parsed.data.force !== undefined) input.force = parsed.data.force;
      const result = splitTask(workspace.backlogDir, input);
      return c.json({
        work_item: result.workItem,
        created_tasks: result.createdTasks,
        mode: result.mode,
      }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message.startsWith("Unknown") || message.includes("Unknown ") ? 404 : 400;
      return c.json({ error: "split_failed", detail: message }, status);
    }
  });

  app.post("/tasks/:id/suggest-split", async (c) => {
    const workspace = c.get("workspace");
    const id = c.req.param("id");
    try {
      const config = loadConfig(workspace.backlogDir);
      const workItem = listTasks(workspace.backlogDir).find((item) => item.id === id);
      if (!workItem) {
        return c.json({ error: "unknown_work_item", id }, 404);
      }
      const repos = config.repos.map((repo) => repo.id);
      if (repos.length === 0) {
        return c.json(
          { error: "no_repos", detail: "Configure at least one repo in the workspace before requesting a split." },
          400,
        );
      }
      const proposal = await suggestSplit(workItem, repos);
      return c.json({
        work_item_id: id,
        model: proposal.model,
        rationale: proposal.rationale,
        tasks: proposal.tasks.map((task) => ({
          title: task.title,
          repo: task.repo,
          scopes: task.scopes,
          risk: task.risk,
          depends_on_indices: task.depends_on_indices,
        })),
      });
    } catch (error) {
      if (error instanceof AiSplitterUnavailableError) {
        return c.json({ error: "ai_unavailable", detail: error.message }, 503);
      }
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "suggest_failed", detail: message }, 500);
    }
  });

  app.post("/tasks/:id/apply-split", async (c) => {
    const workspace = c.get("workspace");
    const id = c.req.param("id");
    const raw = await c.req.json().catch(() => null);
    const parsed = applySplitBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);
    }
    try {
      const result = applySplitProposal(workspace.backlogDir, {
        workItemId: id,
        tasks: parsed.data.tasks.map((task) => ({
          title: task.title,
          repo: task.repo,
          scopes: task.scopes,
          risk: task.risk,
          dependsOnIndices: task.depends_on_indices,
        })),
        ...(parsed.data.force !== undefined ? { force: parsed.data.force } : {}),
      });
      return c.json(
        {
          work_item: result.workItem,
          created_tasks: result.createdTasks,
          mode: result.mode,
        },
        201,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message.startsWith("Unknown") ? 404 : 400;
      return c.json({ error: "apply_failed", detail: message }, status);
    }
  });

  app.post("/tasks/:id/reorder", async (c) => {
    const workspace = c.get("workspace");
    const id = c.req.param("id");
    const raw = await c.req.json().catch(() => ({}));
    const parsed = reorderBodySchema.safeParse(raw ?? {});
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);
    }
    try {
      const input: Parameters<typeof reorderTask>[1] = { workItemId: id };
      if (parsed.data.before_id !== undefined) input.beforeId = parsed.data.before_id;
      if (parsed.data.after_id !== undefined) input.afterId = parsed.data.after_id;
      const workItem = reorderTask(workspace.backlogDir, input);
      return c.json({ work_item: workItem });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "reorder_failed", detail: message }, 404);
    }
  });

  app.patch("/tasks/:id/estimate", async (c) => {
    const workspace = c.get("workspace");
    const id = c.req.param("id");
    const raw = await c.req.json().catch(() => null);
    const parsed = estimateBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);
    }
    try {
      const workItem = setTaskEstimate(workspace.backlogDir, id, parsed.data.seconds);
      return c.json({ work_item: workItem });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "estimate_failed", detail: message }, 404);
    }
  });

  return app;
}
