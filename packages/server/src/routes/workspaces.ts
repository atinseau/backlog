import {
  type RegistryOptions,
  listRegisteredWorkspaces,
  registerWorkspace,
  touchWorkspace,
  unregisterWorkspace,
} from "@backlog/config";
import { Hono } from "hono";
import { z } from "zod";
import type { ServerWorkspace } from "../workspace-context.js";

const registerBodySchema = z
  .object({
    path: z.string().min(1),
  })
  .strict();

export interface WorkspacesRoutesOptions {
  registry?: RegistryOptions;
}

export function workspacesRoutes(
  workspace: ServerWorkspace,
  options: WorkspacesRoutesOptions = {},
): Hono {
  const app = new Hono();
  const registry = options.registry;

  app.get("/workspaces", (c) => {
    return c.json({ workspaces: listRegisteredWorkspaces(registry) });
  });

  app.get("/workspaces/current", (c) => {
    return c.json({
      root: workspace.root,
      backlog_dir: workspace.backlogDir,
      resolved_from: workspace.resolvedFrom,
    });
  });

  app.post("/workspaces", async (c) => {
    const raw = await c.req.json().catch(() => null);
    const parsed = registerBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);
    }
    try {
      const entry = registerWorkspace({ workspaceRoot: parsed.data.path }, registry);
      return c.json({ workspace: entry }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "register_failed", message }, 400);
    }
  });

  app.delete("/workspaces/:idOrPath", (c) => {
    const idOrPath = c.req.param("idOrPath");
    const removed = unregisterWorkspace(idOrPath, registry);
    if (!removed) {
      return c.json({ error: "not_found", id_or_path: idOrPath }, 404);
    }
    return c.json({ workspace: removed });
  });

  app.put("/workspaces/:id/touch", (c) => {
    const id = c.req.param("id");
    touchWorkspace(id, registry);
    return c.json({ ok: true });
  });

  return app;
}
