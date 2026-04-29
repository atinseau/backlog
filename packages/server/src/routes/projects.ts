import {
  type RegistryOptions,
  initLayout,
  listRegisteredProjects,
  loadRegistry,
  registerProject,
  saveRegistry,
  touchProject,
  unregisterProject,
} from "@backlog/config";
import { discoverRepoForWorkspace } from "@backlog/git";
import { Hono } from "hono";
import { z } from "zod";
import type { ServerProject } from "../project-context.js";

const registerBodySchema = z
  .object({
    path: z.string().min(1),
  })
  .strict();

const initBodySchema = z
  .object({
    path: z.string().min(1),
    name: z.string().min(1),
    default_branch: z.string().min(1).optional(),
    force: z.boolean().optional(),
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

  // Init a brand-new project: creates .backlog/ at the given path, then
  // adds it to the user-level registry. Equivalent to `backlog init` from
  // inside the directory, but driven from the board.
  app.post("/projects/init", async (c) => {
    const raw = await c.req.json().catch(() => null);
    const parsed = initBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);
    }
    try {
      // Mirror the CLI's `backlog init` behaviour: if the chosen folder
      // (or any direct child) is a git repository, auto-register it as
      // a repo so the user lands on a usable project. Without this,
      // creating a project from the GUI left repos: [] and the user had
      // to make a separate "Add repository" trip just to actually use
      // the kanban.
      const repos = await discoverRepoForWorkspace(parsed.data.path, parsed.data.name);
      const initOptions: Parameters<typeof initLayout>[0] = {
        root: parsed.data.path,
        projectName: parsed.data.name,
        repos,
      };
      if (parsed.data.default_branch) initOptions.defaultBranch = parsed.data.default_branch;
      if (parsed.data.force) initOptions.force = parsed.data.force;
      initLayout(initOptions);
      const entry = registerProject({ projectRoot: parsed.data.path }, registry);
      return c.json({ project: entry, repos }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "init_failed", message }, 400);
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

  // Rename a registered project. We patch the registry's `name` field
  // only; the on-disk config.toml's project_name stays unchanged
  // (consistent with how `backlog project migrate --name X` is the
  // canonical "fully rename including the slug" path). The dropdown
  // and ProjectsView read from the registry so this is enough for the
  // UI side.
  app.patch("/projects/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    const parsed = z.object({ name: z.string().trim().min(1).max(80) }).safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);
    }
    const reg = loadRegistry(registry);
    const entry = reg.projects.find((p) => p.id === id);
    if (!entry) return c.json({ error: "not_found" }, 404);
    entry.name = parsed.data.name;
    saveRegistry(reg, registry);
    return c.json({ project: entry });
  });

  return app;
}
