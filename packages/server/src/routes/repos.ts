import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "@backlog/config";
import { addRepo, cloneAndAddRepo, getRepo, listRepos, removeRepo, updateRepo } from "@backlog/core";
import { detectRepoRoot, repoCurrentBranch } from "@backlog/git";
import type { RepoConfig } from "@backlog/schemas";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../project-resolver.js";

const accessModeSchema = z.enum(["read-write", "read-only", "no-access"]);

const createBodySchema = z.object({
  id: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
  default_branch: z.string().min(1).optional(),
  role: z.string().optional(),
  enabled: z.boolean().optional(),
  access_mode: accessModeSchema.optional(),
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
    access_mode: accessModeSchema.optional(),
  })
  .strict();

type RepoResponse = RepoConfig & {
  name: string;
  path_exists: boolean;
};

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function repoFolderName(repoPath: string, fallback: string): string {
  const trimmed = repoPath.replace(/[\\/]+$/, "");
  return path.basename(trimmed) || fallback;
}

function decorateRepo(repo: RepoConfig): RepoResponse {
  return {
    ...repo,
    name: repoFolderName(repo.path, repo.id),
    path_exists: fs.existsSync(repo.path),
  };
}

async function resolveRepoBranch(repoPath: string, fallback: string): Promise<string> {
  try {
    const repoRoot = await detectRepoRoot(repoPath);
    const branch = await repoCurrentBranch(repoRoot);
    return branch && branch !== "HEAD" ? branch : fallback;
  } catch {
    return fallback;
  }
}

export function reposRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/repos", (c) => {
    const project = c.get("project");
    return c.json({ repos: listRepos(project.backlogDir).map(decorateRepo) });
  });

  app.get("/repos/:id", (c) => {
    const project = c.get("project");
    const repo = getRepo(project.backlogDir, c.req.param("id"));
    if (!repo) return c.json({ error: "unknown_repo" }, 404);
    return c.json({ repo: decorateRepo(repo) });
  });

  app.post("/repos", async (c) => {
    const project = c.get("project");
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
        if (parsed.data.access_mode !== undefined) cloneInput.accessMode = parsed.data.access_mode;
        const repo = await cloneAndAddRepo(project.backlogDir, cloneInput);
        return c.json({ repo: decorateRepo(repo), cloned: true }, 201);
      }

      if (!parsed.data.path) {
        return c.json(
          { error: "invalid_body", detail: "Provide path, or git_url to clone." },
          400,
        );
      }
      const repoPath = path.resolve(project.root, parsed.data.path);
      const config = loadConfig(project.backlogDir);
      const repoId = parsed.data.id?.trim() || slugify(repoFolderName(repoPath, "repo")) || "repo";
      const defaultBranch = parsed.data.default_branch?.trim() || await resolveRepoBranch(repoPath, config.default_branch);
      const input: Parameters<typeof addRepo>[1] = {
        id: repoId,
        path: repoPath,
        defaultBranch,
      };
      if (parsed.data.role !== undefined) input.role = parsed.data.role;
      if (parsed.data.enabled !== undefined) input.enabled = parsed.data.enabled;
      if (parsed.data.access_mode !== undefined) input.accessMode = parsed.data.access_mode;
      const repo = addRepo(project.backlogDir, input);
      return c.json({ repo: decorateRepo(repo), cloned: false }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "create_failed", detail: message }, 400);
    }
  });

  app.patch("/repos/:id", async (c) => {
    const project = c.get("project");
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
    if (parsed.data.access_mode !== undefined) input.accessMode = parsed.data.access_mode;

    try {
      const repo = updateRepo(project.backlogDir, c.req.param("id"), input);
      return c.json({ repo: decorateRepo(repo) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message.startsWith("Unknown") ? 404 : 400;
      return c.json({ error: "update_failed", detail: message }, status);
    }
  });

  app.delete("/repos/:id", async (c) => {
    const project = c.get("project");
    const force = c.req.query("force") === "1" || c.req.query("force") === "true";
    try {
      const repo = removeRepo(project.backlogDir, c.req.param("id"), { force });
      return c.json({ repo: decorateRepo(repo) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message.startsWith("Unknown") ? 404 : 400;
      return c.json({ error: "delete_failed", detail: message }, status);
    }
  });

  return app;
}
