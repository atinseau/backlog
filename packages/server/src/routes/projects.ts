import {
  type RegistryOptions,
  listRegisteredProjects,
  registerProject,
  touchProject,
  unregisterProject,
} from "@backlog/config";
import { Hono } from "hono";
import { z } from "zod";
import type { ServerProject } from "../project-context.js";

const registerBodySchema = z
  .object({
    path: z.string().min(1),
  })
  .strict();

export interface ProjectsRoutesOptions {
  registry?: RegistryOptions;
}

export function projectsRoutes(
  workspace: ServerProject,
  options: ProjectsRoutesOptions = {},
): Hono {
  const app = new Hono();
  const registry = options.registry;

  app.get("/projects", (c) => {
    return c.json({ projects: listRegisteredProjects(registry) });
  });

  app.get("/projects/current", (c) => {
    return c.json({
      root: workspace.root,
      backlog_dir: workspace.backlogDir,
      resolved_from: workspace.resolvedFrom,
    });
  });

  app.post("/projects", async (c) => {
    const raw = await c.req.json().catch(() => null);
    const parsed = registerBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);
    }
    try {
      const entry = registerProject({ projectRoot: parsed.data.path }, registry);
      return c.json({ project: entry }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "register_failed", message }, 400);
    }
  });

  app.delete("/projects/:idOrPath", (c) => {
    const idOrPath = c.req.param("idOrPath");
    const removed = unregisterProject(idOrPath, registry);
    if (!removed) {
      return c.json({ error: "not_found", id_or_path: idOrPath }, 404);
    }
    return c.json({ project: removed });
  });

  app.put("/projects/:id/touch", (c) => {
    const id = c.req.param("id");
    touchProject(id, registry);
    return c.json({ ok: true });
  });

  return app;
}
