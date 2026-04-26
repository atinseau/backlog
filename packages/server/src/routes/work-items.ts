import { updateWorkItemStatus } from "@backlog/core";
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

  return app;
}
