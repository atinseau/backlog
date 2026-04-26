import { updateTaskStatus } from "@backlog/core";
import { Hono } from "hono";
import { z } from "zod";
import type { ServerWorkspace } from "../workspace-context.js";

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

export function tasksRoutes(workspace: ServerWorkspace): Hono {
  const app = new Hono();

  app.post("/tasks/:id/move", async (c) => {
    const id = c.req.param("id");
    const raw = await c.req.json().catch(() => null);
    const parsed = moveBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);
    }
    try {
      const updated = updateTaskStatus(workspace.backlogDir, id, parsed.data.to);
      return c.json({ task: updated });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "update_failed", detail: message }, 404);
    }
  });

  return app;
}
