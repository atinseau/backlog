import {
  archiveProject,
  createProject,
  getProject,
  listProjects,
  removeProject,
  updateProject,
} from "@backlog/core";
import { Hono } from "hono";
import { z } from "zod";
import type { ServerWorkspace } from "../workspace-context.js";

const slugSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "slug must be lowercase alphanumeric with dashes");

const createBodySchema = z.object({
  slug: slugSchema,
  name: z.string().min(1),
  description: z.string().optional(),
  color: z.string().optional(),
  repo_ids: z.array(z.string()).default([]),
  max_agents: z.number().int().positive().optional(),
});

const updateBodySchema = z
  .object({
    slug: slugSchema.optional(),
    name: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    color: z.string().nullable().optional(),
    repo_ids: z.array(z.string()).optional(),
    max_agents: z.number().int().positive().nullable().optional(),
    archived: z.boolean().optional(),
  })
  .strict();

export function projectsRoutes(workspace: ServerWorkspace): Hono {
  const app = new Hono();

  app.get("/projects", (c) => {
    const includeArchived = c.req.query("archived") === "1";
    const projects = listProjects(workspace.backlogDir).filter((p) => includeArchived || !p.archived);
    return c.json({ projects });
  });

  app.get("/projects/:idOrSlug", (c) => {
    const project = getProject(workspace.backlogDir, c.req.param("idOrSlug"));
    if (!project) return c.json({ error: "unknown_project" }, 404);
    return c.json({ project });
  });

  app.post("/projects", async (c) => {
    const raw = await c.req.json().catch(() => null);
    const parsed = createBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);
    }
    try {
      const input: Parameters<typeof createProject>[1] = {
        slug: parsed.data.slug,
        name: parsed.data.name,
        repoIds: parsed.data.repo_ids,
      };
      if (parsed.data.description !== undefined) input.description = parsed.data.description;
      if (parsed.data.color !== undefined) input.color = parsed.data.color;
      if (parsed.data.max_agents !== undefined) input.maxAgents = parsed.data.max_agents;
      const project = createProject(workspace.backlogDir, input);
      return c.json({ project }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "create_failed", detail: message }, 400);
    }
  });

  app.patch("/projects/:idOrSlug", async (c) => {
    const raw = await c.req.json().catch(() => null);
    const parsed = updateBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);
    }
    const input: Parameters<typeof updateProject>[2] = {};
    if (parsed.data.slug !== undefined) input.slug = parsed.data.slug;
    if (parsed.data.name !== undefined) input.name = parsed.data.name;
    if (parsed.data.description === null) input.clearDescription = true;
    else if (parsed.data.description !== undefined) input.description = parsed.data.description;
    if (parsed.data.color === null) input.clearColor = true;
    else if (parsed.data.color !== undefined) input.color = parsed.data.color;
    if (parsed.data.repo_ids !== undefined) input.repoIds = parsed.data.repo_ids;
    if (parsed.data.max_agents === null) input.clearMaxAgents = true;
    else if (parsed.data.max_agents !== undefined) input.maxAgents = parsed.data.max_agents;
    if (parsed.data.archived !== undefined) input.archived = parsed.data.archived;

    try {
      const project = updateProject(workspace.backlogDir, c.req.param("idOrSlug"), input);
      return c.json({ project });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message.startsWith("Unknown") ? 404 : 400;
      return c.json({ error: "update_failed", detail: message }, status);
    }
  });

  app.post("/projects/:idOrSlug/archive", (c) => {
    try {
      const project = archiveProject(workspace.backlogDir, c.req.param("idOrSlug"));
      return c.json({ project });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "archive_failed", detail: message }, 404);
    }
  });

  app.delete("/projects/:idOrSlug", (c) => {
    try {
      const project = removeProject(workspace.backlogDir, c.req.param("idOrSlug"));
      return c.json({ project });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "delete_failed", detail: message }, 404);
    }
  });

  return app;
}
