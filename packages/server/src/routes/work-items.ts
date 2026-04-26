import { loadConfig } from "@backlog/config";
import {
  listWorkItems,
  resolveSplitRepos,
  splitWorkItem,
  updateWorkItemStatus,
} from "@backlog/core";
import { Hono } from "hono";
import { z } from "zod";
import type { ServerWorkspace } from "../workspace-context.js";

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

const splitBodySchema = z.object({
  repos: z.array(z.string().min(1)).optional(),
  mode: z.enum(["parallel", "serial"]).default("parallel"),
  scope_by_repo: z.record(z.string(), z.array(z.string())).optional(),
  risk: z.enum(["low", "medium", "high"]).optional(),
  force: z.boolean().optional(),
});

export function workItemsRoutes(workspace: ServerWorkspace): Hono {
  const app = new Hono();

  app.post("/work-items/:id/move", async (c) => {
    const id = c.req.param("id");
    const raw = await c.req.json().catch(() => null);
    const parsed = moveBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);
    }
    try {
      const updated = updateWorkItemStatus(workspace.backlogDir, id, parsed.data.to);
      return c.json({ work_item: updated });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "update_failed", detail: message }, 404);
    }
  });

  app.post("/work-items/:id/split", async (c) => {
    const id = c.req.param("id");
    const raw = await c.req.json().catch(() => null);
    const parsed = splitBodySchema.safeParse(raw ?? {});
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);
    }
    try {
      const config = loadConfig(workspace.backlogDir);
      const workItem = listWorkItems(workspace.backlogDir).find((item) => item.id === id);
      if (!workItem) {
        return c.json({ error: "unknown_work_item", id }, 404);
      }
      const repos = resolveSplitRepos(config, workItem, parsed.data.repos);
      const input: Parameters<typeof splitWorkItem>[1] = {
        workItemId: id,
        repos,
        mode: parsed.data.mode,
      };
      if (parsed.data.scope_by_repo !== undefined) input.scopeByRepo = parsed.data.scope_by_repo;
      if (parsed.data.risk !== undefined) input.risk = parsed.data.risk;
      if (parsed.data.force !== undefined) input.force = parsed.data.force;
      const result = splitWorkItem(workspace.backlogDir, input);
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

  return app;
}
