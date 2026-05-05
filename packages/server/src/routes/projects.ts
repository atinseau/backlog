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
import { cloneRepo, detectGitProvider, discoverRepoForProject, repoIdFromGitUrl } from "@backlog/git";
import { execa } from "execa";
import { Hono } from "hono";
import { z } from "zod";
import type { ServerProject } from "../project-context.js";
import type { AppEnv } from "../project-resolver.js";

const registerBodySchema = z
  .object({
    path: z.string().min(1),
  })
  .strict();

const initBodySchema = z
  .object({
    path: z.string().min(1),
    name: z.string().min(1),
    git_url: z.string().min(1).optional(),
    default_branch: z.string().min(1).optional(),
    force: z.boolean().optional(),
  })
  .strict();

export interface ProjectsRoutesOptions {
  registry?: RegistryOptions;
}

function compareLabel(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function sortProjects<T extends { id: string; name?: string; path?: string }>(projects: T[]): T[] {
  return projects.slice().sort((a, b) =>
    compareLabel(a.name || a.id, b.name || b.id)
    || compareLabel(a.path || "", b.path || "")
    || compareLabel(a.id, b.id),
  );
}

export function projectsRoutes(
  defaultProject: ServerProject,
  options: ProjectsRoutesOptions = {},
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const registry = options.registry;

  app.get("/projects", (c) => {
    return c.json({ projects: sortProjects(listRegisteredProjects(registry)) });
  });

  app.get("/projects/current", (c) => {
    const current = c.get("project") ?? defaultProject;
    return c.json({
      project_id: current.project_id,
      root: current.root,
      backlog_dir: current.backlogDir,
      resolved_from: current.resolvedFrom,
      transient: current.transient ?? false,
      repo_only: current.repoOnly ?? null,
    });
  });

  app.get("/projects/git/branches", async (c) => {
    const url = c.req.query("url")?.trim();
    if (!url) {
      return c.json({ error: "git_url_required" }, 400);
    }
    try {
      const result = await execa("git", ["ls-remote", "--heads", "--symref", url], {
        reject: false,
        timeout: 8000,
      });
      if (result.exitCode !== 0) {
        return c.json({
          error: "git_ls_remote_failed",
          message: result.stderr.trim() || result.stdout.trim() || "Unable to read remote branches.",
        }, 400);
      }
      const branches: string[] = [];
      let defaultBranch: string | null = null;
      for (const rawLine of result.stdout.split("\n")) {
        const line = rawLine.trim();
        if (!line) continue;
        const symref = line.match(/^ref:\s+refs\/heads\/(.+)\s+HEAD$/);
        if (symref?.[1]) {
          defaultBranch = symref[1];
          continue;
        }
        const marker = "\trefs/heads/";
        const idx = line.indexOf(marker);
        if (idx >= 0) {
          const branch = line.slice(idx + marker.length).trim();
          if (branch && !branches.includes(branch)) branches.push(branch);
        }
      }
      if (defaultBranch && !branches.includes(defaultBranch)) branches.unshift(defaultBranch);
      const inferredDefault = defaultBranch
        ?? (branches.includes("main") ? "main" : branches.includes("master") ? "master" : branches[0] ?? null);
      if (inferredDefault) {
        branches.sort((a, b) => {
          if (a === inferredDefault) return -1;
          if (b === inferredDefault) return 1;
          return a.localeCompare(b);
        });
      }
      return c.json({ branches, default_branch: inferredDefault });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "git_ls_remote_failed", message }, 400);
    }
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
      if (parsed.data.git_url) {
        await cloneRepo({
          url: parsed.data.git_url,
          dest: parsed.data.path,
          ...(parsed.data.default_branch ? { branch: parsed.data.default_branch } : {}),
        });
      }

      // Mirror the CLI's `backlog init` behaviour: if the chosen folder
      // (or any direct child) is a git repository, auto-register it as
      // a repo so the user lands on a usable project.
      let repos = await discoverRepoForProject(parsed.data.path, parsed.data.name);
      if (parsed.data.git_url && repos[0]) {
        const provider = detectGitProvider(parsed.data.git_url);
        const remoteProvider = provider === "github" || provider === "gitlab" || provider === "bitbucket"
          ? provider
          : "custom";
        repos = [
          {
            ...repos[0],
            id: repoIdFromGitUrl(parsed.data.git_url),
            location: "remote",
            remote_type: "git",
            remote_provider: remoteProvider,
            remote_url: parsed.data.git_url,
            git_url: parsed.data.git_url,
            provider,
          },
        ];
      }
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
