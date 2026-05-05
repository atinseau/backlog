import fs from "node:fs";
import path from "node:path";
import { getSecret, loadConfig } from "@backlog/config";
import { addRepo, cloneAndAddRepo, createRepoCheckout, getRepo, listRepos, removeRepo, updateRepo } from "@backlog/core";
import { detectRepoRoot, git, repoCurrentBranch } from "@backlog/git";
import { repoCheckoutPath } from "@backlog/schemas";
import type { RepoConfig } from "@backlog/schemas";
import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";
import type { AppEnv } from "../project-resolver.js";

const accessModeSchema = z.enum(["read-write", "read-only", "no-access"]);
const locationSchema = z.enum(["local", "remote"]);
const remoteTypeSchema = z.enum(["git", "ftp", "sftp", "other"]);
const remoteProviderSchema = z.enum(["github", "gitlab", "bitbucket", "custom", "other"]);
const legacyProviderSchema = z.enum(["local", "github", "gitlab", "bitbucket", "other"]);
const GITHUB_TOKEN_KEY = "github.pat";

const createBodySchema = z.object({
  id: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
  default_branch: z.string().min(1).optional(),
  role: z.string().optional(),
  enabled: z.boolean().optional(),
  access_mode: accessModeSchema.optional(),
  location: locationSchema.optional(),
  remote_type: remoteTypeSchema.optional(),
  remote_provider: remoteProviderSchema.optional(),
  remote_url: z.string().min(1).optional(),
  git_url: z.string().min(1).optional(),
  provider: legacyProviderSchema.optional(),
  clone_into: z.string().min(1).optional(),
  checkout: z.boolean().optional(),
});

const updateBodySchema = z
  .object({
    id: z.string().min(1).optional(),
    path: z.string().min(1).optional(),
    default_branch: z.string().min(1).optional(),
    role: z.string().nullable().optional(),
    enabled: z.boolean().optional(),
    access_mode: accessModeSchema.optional(),
    location: locationSchema.optional(),
    remote_type: remoteTypeSchema.nullable().optional(),
    remote_provider: remoteProviderSchema.nullable().optional(),
    remote_url: z.string().min(1).nullable().optional(),
    git_url: z.string().min(1).nullable().optional(),
    provider: legacyProviderSchema.nullable().optional(),
  })
  .strict();

const checkoutBodySchema = z.object({
  path: z.string().min(1).optional(),
  use_ssh: z.boolean().optional(),
}).optional();

type RepoResponse = RepoConfig & {
  name: string;
  path_exists: boolean;
  has_local_checkout: boolean;
};

type RepositoryResponse = {
  repo: RepoResponse;
  repository: RepoResponse;
};

type RepositoriesResponse = {
  repos: RepoResponse[];
  repositories: RepoResponse[];
};

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function repoFolderName(repoPath: string, fallback: string): string {
  const trimmed = repoPath.replace(/[\\/]+$/, "");
  return path.basename(trimmed) || fallback;
}

function compareLabel(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function sortRepoResponses<T extends Pick<RepoResponse, "id" | "name">>(repositories: T[]): T[] {
  return repositories.slice().sort((a, b) =>
    compareLabel(a.name || a.id, b.name || b.id)
    || compareLabel(a.id, b.id),
  );
}

function githubFullNameFromUrl(value: string): string | null {
  const remoteUrl = value.trim().replace(/\.git$/i, "");
  const httpsMatch = /^https?:\/\/(?:[^@/]+@)?github\.com\/([^/]+\/[^/#?]+)$/i.exec(remoteUrl);
  if (httpsMatch?.[1]) return httpsMatch[1];
  const sshMatch = /^(?:ssh:\/\/)?git@github\.com[:/]([^/]+\/[^/#?]+)$/i.exec(remoteUrl);
  if (sshMatch?.[1]) return sshMatch[1];
  return null;
}

function cloneUrlForCheckout(backlogDir: string, repo: RepoConfig, useSsh = false): { cloneUrl: string; cleanUrl: string } {
  const cleanUrl = repo.remote_url ?? repo.git_url;
  if (!cleanUrl) throw new Error(`Repository ${repo.id} has no remote URL.`);
  const provider = repo.remote_provider ?? repo.provider;
  const fullName = provider === "github" ? githubFullNameFromUrl(cleanUrl) : null;
  if (fullName && useSsh) {
    return { cloneUrl: `git@github.com:${fullName}.git`, cleanUrl: `https://github.com/${fullName}.git` };
  }
  const token = fullName ? getSecret(backlogDir, GITHUB_TOKEN_KEY) : null;
  if (fullName && token) {
    return {
      cloneUrl: `https://x-access-token:${token}@github.com/${fullName}.git`,
      cleanUrl: `https://github.com/${fullName}.git`,
    };
  }
  return { cloneUrl: cleanUrl, cleanUrl };
}

function decorateRepo(repo: RepoConfig): RepoResponse {
  const checkoutPath = repoCheckoutPath(repo);
  return {
    ...repo,
    ...(checkoutPath ? { path: checkoutPath, checkout_path: checkoutPath } : {}),
    name: repoFolderName(checkoutPath ?? repo.remote_url ?? repo.id, repo.id),
    path_exists: checkoutPath ? fs.existsSync(checkoutPath) : false,
    has_local_checkout: Boolean(checkoutPath),
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

  const listHandler = (c: Context<AppEnv>) => {
    const project = c.get("project");
    const repositories = sortRepoResponses(listRepos(project.backlogDir).map(decorateRepo));
    return c.json({ repos: repositories, repositories } satisfies RepositoriesResponse);
  };

  const showHandler = (c: Context<AppEnv>) => {
    const project = c.get("project");
    const id = c.req.param("id");
    if (!id) return c.json({ error: "missing_repository_id" }, 400);
    const raw = getRepo(project.backlogDir, id);
    if (!raw) return c.json({ error: "unknown_repo" }, 404);
    const repository = decorateRepo(raw);
    return c.json({ repo: repository, repository } satisfies RepositoryResponse);
  };

  const createHandler = async (c: Context<AppEnv>) => {
    const project = c.get("project");
    const raw = await c.req.json().catch(() => null);
    const parsed = createBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);
    }

    try {
      const cloneUrl = parsed.data.remote_url ?? parsed.data.git_url;
      if (cloneUrl && !parsed.data.path && parsed.data.checkout !== false) {
        if (parsed.data.remote_type && parsed.data.remote_type !== "git") {
          return c.json({ error: "unsupported_remote_type", detail: "Only Git remotes can be cloned by the local server today." }, 400);
        }
        const cloneInput: Parameters<typeof cloneAndAddRepo>[1] = { url: cloneUrl };
        if (parsed.data.id) cloneInput.id = parsed.data.id;
        if (parsed.data.clone_into) cloneInput.destDir = parsed.data.clone_into;
        if (parsed.data.default_branch) cloneInput.defaultBranch = parsed.data.default_branch;
        if (parsed.data.role !== undefined) cloneInput.role = parsed.data.role;
        if (parsed.data.enabled !== undefined) cloneInput.enabled = parsed.data.enabled;
        if (parsed.data.access_mode !== undefined) cloneInput.accessMode = parsed.data.access_mode;
        if (parsed.data.remote_provider !== undefined) cloneInput.remoteProvider = parsed.data.remote_provider;
        const repository = decorateRepo(await cloneAndAddRepo(project.backlogDir, cloneInput));
        return c.json({ repo: repository, repository, cloned: true }, 201);
      }

      if (!parsed.data.path && (parsed.data.location ?? "local") !== "remote") {
        return c.json(
          { error: "invalid_body", detail: "Provide path, or remote_url/git_url for a remote repository." },
          400,
        );
      }
      const repoPath = parsed.data.path ? path.resolve(project.root, parsed.data.path) : undefined;
      const config = loadConfig(project.backlogDir);
      const idSource = repoPath ?? cloneUrl ?? parsed.data.remote_url ?? "repository";
      const repoId = parsed.data.id?.trim() || slugify(repoFolderName(idSource, "repo")) || "repo";
      const defaultBranch = parsed.data.default_branch?.trim() || (repoPath ? await resolveRepoBranch(repoPath, config.default_branch) : config.default_branch);
      const input: Parameters<typeof addRepo>[1] = {
        id: repoId,
        defaultBranch,
      };
      if (repoPath) input.path = repoPath;
      if (parsed.data.role !== undefined) input.role = parsed.data.role;
      if (parsed.data.enabled !== undefined) input.enabled = parsed.data.enabled;
      if (parsed.data.access_mode !== undefined) input.accessMode = parsed.data.access_mode;
      input.location = parsed.data.location ?? (cloneUrl ? "remote" : "local");
      if (parsed.data.remote_type !== undefined) input.remoteType = parsed.data.remote_type;
      else if (cloneUrl) input.remoteType = "git";
      if (parsed.data.remote_provider !== undefined) input.remoteProvider = parsed.data.remote_provider;
      if (parsed.data.remote_url !== undefined) input.remoteUrl = parsed.data.remote_url;
      if (parsed.data.git_url !== undefined) input.gitUrl = parsed.data.git_url;
      if (parsed.data.provider !== undefined) input.provider = parsed.data.provider;
      const repository = decorateRepo(addRepo(project.backlogDir, input));
      return c.json({ repo: repository, repository, cloned: false }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "create_failed", detail: message }, 400);
    }
  };

  const updateHandler = async (c: Context<AppEnv>) => {
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
    if (parsed.data.location !== undefined) input.location = parsed.data.location;
    if (parsed.data.remote_type === null) input.clearRemoteType = true;
    else if (parsed.data.remote_type !== undefined) input.remoteType = parsed.data.remote_type;
    if (parsed.data.remote_provider === null) input.clearRemoteProvider = true;
    else if (parsed.data.remote_provider !== undefined) input.remoteProvider = parsed.data.remote_provider;
    if (parsed.data.remote_url === null) input.clearRemoteUrl = true;
    else if (parsed.data.remote_url !== undefined) input.remoteUrl = parsed.data.remote_url;
    if (parsed.data.git_url === null) input.clearGitUrl = true;
    else if (parsed.data.git_url !== undefined) input.gitUrl = parsed.data.git_url;
    if (parsed.data.provider === null) input.clearProvider = true;
    else if (parsed.data.provider !== undefined) input.provider = parsed.data.provider;

    try {
      const id = c.req.param("id");
      if (!id) return c.json({ error: "missing_repository_id" }, 400);
      const repository = decorateRepo(updateRepo(project.backlogDir, id, input));
      return c.json({ repo: repository, repository } satisfies RepositoryResponse);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message.startsWith("Unknown") ? 404 : 400;
      return c.json({ error: "update_failed", detail: message }, status);
    }
  };

  const checkoutHandler = async (c: Context<AppEnv>) => {
    const project = c.get("project");
    const raw = await c.req.json().catch(() => undefined);
    const parsed = checkoutBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);
    }
    try {
      const id = c.req.param("id");
      if (!id) return c.json({ error: "missing_repository_id" }, 400);
      const repo = getRepo(project.backlogDir, id);
      if (!repo) return c.json({ error: "unknown_repo" }, 404);
      const { cloneUrl, cleanUrl } = cloneUrlForCheckout(project.backlogDir, repo, parsed.data?.use_ssh);
      const checkout = await createRepoCheckout(project.backlogDir, id, {
        cloneUrl,
        ...(parsed.data?.path ? { path: parsed.data.path } : {}),
      });
      const checkoutPath = repoCheckoutPath(checkout);
      if (checkoutPath && cloneUrl !== cleanUrl) {
        await git(["remote", "set-url", "origin", cleanUrl], checkoutPath).catch(() => undefined);
      }
      const repository = decorateRepo(checkout);
      return c.json({ repo: repository, repository, cloned: true } satisfies RepositoryResponse & { cloned: boolean });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message.startsWith("Unknown") ? 404 : 400;
      return c.json({ error: "checkout_failed", detail: message }, status);
    }
  };

  const deleteHandler = async (c: Context<AppEnv>) => {
    const project = c.get("project");
    const force = c.req.query("force") === "1" || c.req.query("force") === "true";
    try {
      const id = c.req.param("id");
      if (!id) return c.json({ error: "missing_repository_id" }, 400);
      const repository = decorateRepo(removeRepo(project.backlogDir, id, { force }));
      return c.json({ repo: repository, repository } satisfies RepositoryResponse);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message.startsWith("Unknown") ? 404 : 400;
      return c.json({ error: "delete_failed", detail: message }, status);
    }
  };

  app.get("/repos", listHandler);
  app.get("/repositories", listHandler);
  app.get("/repos/:id", showHandler);
  app.get("/repositories/:id", showHandler);
  app.post("/repos", createHandler);
  app.post("/repositories", createHandler);
  app.patch("/repos/:id", updateHandler);
  app.patch("/repositories/:id", updateHandler);
  app.post("/repos/:id/checkout", checkoutHandler);
  app.post("/repositories/:id/checkout", checkoutHandler);
  app.delete("/repos/:id", deleteHandler);
  app.delete("/repositories/:id", deleteHandler);

  return app;
}
