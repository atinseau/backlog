import { addRepo, cloneAndAddRepo, getRepo, listRepos, removeRepo, updateRepo } from "@backlog/core";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../workspace-resolver.js";

const createBodySchema = z.object({
  id: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
  default_branch: z.string().min(1).optional(),
  role: z.string().optional(),
  enabled: z.boolean().optional(),
  git_url: z.string().min(1).optional(),
  clone_into: z.string().min(1).optional(),
});

const updateBodySchema = z
  .object({
    id: z.string().min(1).optional(),
    path: z.string().min(1).optional(),
    default_branch: z.string().min(1).optional(),
    role: z.string().nullable().optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

export function reposRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/repos", (c) => {
    const workspace = c.get("workspace");
    return c.json({ repos: listRepos(workspace.backlogDir) });
  });

  app.get("/repos/:id", (c) => {
    const workspace = c.get("workspace");
    const repo = getRepo(workspace.backlogDir, c.req.param("id"));
    if (!repo) return c.json({ error: "unknown_repo" }, 404);
    return c.json({ repo });
  });

  app.post("/repos", async (c) => {
    const workspace = c.get("workspace");
    const raw = await c.req.json().catch(() => null);
    const parsed = createBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);
    }

    try {
      if (parsed.data.git_url) {
        const cloneInput: Parameters<typeof cloneAndAddRepo>[1] = { url: parsed.data.git_url };
        if (parsed.data.id) cloneInput.id = parsed.data.id;
        if (parsed.data.clone_into) cloneInput.destDir = parsed.data.clone_into;
        if (parsed.data.default_branch) cloneInput.defaultBranch = parsed.data.default_branch;
        if (parsed.data.role !== undefined) cloneInput.role = parsed.data.role;
        if (parsed.data.enabled !== undefined) cloneInput.enabled = parsed.data.enabled;
        const repo = await cloneAndAddRepo(workspace.backlogDir, cloneInput);
        return c.json({ repo, cloned: true }, 201);
      }

      if (!parsed.data.id || !parsed.data.path || !parsed.data.default_branch) {
        return c.json(
          { error: "invalid_body", detail: "Provide id + path + default_branch, or git_url to clone." },
          400,
        );
      }
      const input: Parameters<typeof addRepo>[1] = {
        id: parsed.data.id,
        path: parsed.data.path,
        defaultBranch: parsed.data.default_branch,
      };
      if (parsed.data.role !== undefined) input.role = parsed.data.role;
      if (parsed.data.enabled !== undefined) input.enabled = parsed.data.enabled;
      const repo = addRepo(workspace.backlogDir, input);
      return c.json({ repo, cloned: false }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "create_failed", detail: message }, 400);
    }
  });

  app.patch("/repos/:id", async (c) => {
    const workspace = c.get("workspace");
    const raw = await c.req.json().catch(() => null);
    const parsed = updateBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);
    }
    const input: Parameters<typeof updateRepo>[2] = {};
    if (parsed.data.id !== undefined) input.id = parsed.data.id;
    if (parsed.data.path !== undefined) input.path = parsed.data.path;
    if (parsed.data.default_branch !== undefined) input.defaultBranch = parsed.data.default_branch;
    if (parsed.data.role === null) input.clearRole = true;
    else if (parsed.data.role !== undefined) input.role = parsed.data.role;
    if (parsed.data.enabled !== undefined) input.enabled = parsed.data.enabled;

    try {
      const repo = updateRepo(workspace.backlogDir, c.req.param("id"), input);
      return c.json({ repo });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message.startsWith("Unknown") ? 404 : 400;
      return c.json({ error: "update_failed", detail: message }, status);
    }
  });

  app.delete("/repos/:id", async (c) => {
    const workspace = c.get("workspace");
    const force = c.req.query("force") === "1" || c.req.query("force") === "true";
    try {
      const repo = removeRepo(workspace.backlogDir, c.req.param("id"), { force });
      return c.json({ repo });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message.startsWith("Unknown") ? 404 : 400;
      return c.json({ error: "delete_failed", detail: message }, status);
    }
  });

  return app;
}
