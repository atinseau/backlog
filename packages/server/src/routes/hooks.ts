import { listRepos } from "@backlog/core";
import { isLocalShimUpToDate, pickLocalShimProjectRoot, writeLocalShim } from "@backlog/config";
import { repoCheckoutPath, type RepoConfig } from "@backlog/schemas";
import { PRE_COMMIT_HOOK_VERSION, inspectPreCommitHook, installPreCommitHook, readPauseUntil, uninstallPreCommitHook } from "@backlog/hooks";
import { Hono } from "hono";
import path from "node:path";
import fs from "node:fs";
import type { AppEnv } from "../project-resolver.js";

// Hooks status endpoint — surface the inspectPreCommitHook output for
// each registered repository so the UI can show a per-repo install
// status without shelling out to the CLI.

interface HookStatus {
  repo_id: string;
  repo_path: string;
  git_dir: string;
  hook_path: string;
  exists: boolean;
  managed: boolean;
  installed_version: string | null;
  expected_version: string;
  points_to_backlog_bin: boolean;
  shim_up_to_date: boolean;
  up_to_date: boolean;
}

interface HooksOverview {
  project_paused_until: string | null;
  hooks: HookStatus[];
}

function findGitDir(repoPath: string): string | null {
  // Walk up from the repo root looking for a .git directory or file
  // (worktrees use a .git file pointing at the gitdir). Stop at the
  // root of the filesystem.
  let dir = path.resolve(repoPath);
  while (true) {
    const candidate = path.join(dir, ".git");
    if (fs.existsSync(candidate)) {
      // .git can be a file (worktree) — resolve to its gitdir.
      const stat = fs.statSync(candidate);
      if (stat.isDirectory()) return candidate;
      try {
        const txt = fs.readFileSync(candidate, "utf8").trim();
        const match = /^gitdir:\s*(.+)$/.exec(txt);
        if (match) {
          const target = path.isAbsolute(match[1]!)
            ? match[1]!
            : path.resolve(dir, match[1]!);
          if (fs.existsSync(target)) return target;
        }
      } catch {
        // Fall through and keep walking; better to surface "no hook" than crash.
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function resolveRepoPath(projectRoot: string, repoPath: string): string {
  return path.isAbsolute(repoPath)
    ? repoPath
    : path.resolve(projectRoot, repoPath);
}

function compareLabel(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function repoSortName(repo: RepoConfig): string {
  const candidate = (repo as { name?: string }).name ?? repo.checkout_path ?? repo.path ?? repo.remote_url ?? repo.git_url ?? repo.id;
  return path.basename(candidate.replace(/[\\/]+$/, "")) || repo.id;
}

function sortRepos(repos: RepoConfig[]): RepoConfig[] {
  return repos.slice().sort((a, b) =>
    compareLabel(repoSortName(a), repoSortName(b))
    || compareLabel(a.id, b.id),
  );
}

export function hooksRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/hooks/status", (c) => {
    const project = c.get("project");
    const repos = sortRepos(listRepos(project.backlogDir));
    const backlogBin = path.join(project.backlogDir, "bin", "backlog");
    const repoPaths = repos
      .map((repo) => repoCheckoutPath(repo))
      .filter((repoPath): repoPath is string => Boolean(repoPath))
      .map((repoPath) => resolveRepoPath(project.root, repoPath));
    const shimProjectRoot = pickLocalShimProjectRoot(project.root, repoPaths);
    const shimUpToDate = isLocalShimUpToDate(project.backlogDir, shimProjectRoot);

    const out: HookStatus[] = [];
    for (const repo of repos) {
      const checkoutPath = repoCheckoutPath(repo);
      if (!checkoutPath) {
        out.push({
          repo_id: repo.id,
          repo_path: "",
          git_dir: "",
          hook_path: "",
          exists: false,
          managed: false,
          installed_version: null,
          expected_version: PRE_COMMIT_HOOK_VERSION,
          points_to_backlog_bin: false,
          shim_up_to_date: shimUpToDate,
          up_to_date: false,
        });
        continue;
      }
      const repoPath = resolveRepoPath(project.root, checkoutPath);
      const gitDir = findGitDir(repoPath);
      if (!gitDir) {
        out.push({
          repo_id: repo.id,
          repo_path: repoPath,
          git_dir: "",
          hook_path: "",
          exists: false,
          managed: false,
          installed_version: null,
          expected_version: PRE_COMMIT_HOOK_VERSION,
          points_to_backlog_bin: false,
          shim_up_to_date: shimUpToDate,
          up_to_date: false,
        });
        continue;
      }
      const status = inspectPreCommitHook(gitDir, backlogBin, {
        projectRoot: project.root,
        backlogDir: project.backlogDir,
      });
      out.push({
        repo_id: repo.id,
        repo_path: repoPath,
        git_dir: gitDir,
        hook_path: status.hookPath,
        exists: status.exists,
        managed: status.managed,
        installed_version: status.installedVersion ?? null,
        expected_version: PRE_COMMIT_HOOK_VERSION,
        points_to_backlog_bin: status.pointsToBacklogBin,
        shim_up_to_date: shimUpToDate,
        up_to_date: status.upToDate && shimUpToDate,
      });
    }

    const pause = readPauseUntil(project.backlogDir);
    const overview: HooksOverview = {
      project_paused_until: pause,
      hooks: out,
    };
    return c.json(overview);
  });

  app.post("/hooks/install", async (c) => {
    const project = c.get("project");
    const raw = await c.req.json().catch(() => null) as { repo_id?: unknown; force?: unknown } | null;
    const repoId = typeof raw?.repo_id === "string" ? raw.repo_id : "";
    const force = raw?.force === true;
    if (!repoId) return c.json({ error: "missing_repo_id" }, 400);

    const repo = listRepos(project.backlogDir).find((candidate) => candidate.id === repoId);
    if (!repo) return c.json({ error: "unknown_repo", repo_id: repoId }, 404);
    const checkoutPath = repoCheckoutPath(repo);
    if (!checkoutPath) return c.json({ error: "repository_has_no_local_checkout", repo_id: repoId }, 400);

    const repoPath = resolveRepoPath(project.root, checkoutPath);
    const gitDir = findGitDir(repoPath);
    if (!gitDir) return c.json({ error: "not_a_git_repo", repo_id: repoId, repo_path: repoPath }, 400);

    try {
      const shimProjectRoot = pickLocalShimProjectRoot(project.root, [repoPath]);
      const backlogBin = writeLocalShim(project.backlogDir, shimProjectRoot);
      const hookPath = installPreCommitHook({
        gitDir,
        backlogBin,
        projectRoot: project.root,
        backlogDir: project.backlogDir,
        ...(force ? { force: true } : {}),
      });
      const status = inspectPreCommitHook(gitDir, backlogBin, {
        projectRoot: project.root,
        backlogDir: project.backlogDir,
      });
      const shimUpToDate = isLocalShimUpToDate(project.backlogDir, shimProjectRoot);
      return c.json({
        repo_id: repo.id,
        repo_path: repoPath,
        git_dir: gitDir,
        hook_path: hookPath,
        exists: status.exists,
        managed: status.managed,
        installed_version: status.installedVersion ?? null,
        expected_version: PRE_COMMIT_HOOK_VERSION,
        points_to_backlog_bin: status.pointsToBacklogBin,
        shim_up_to_date: shimUpToDate,
        up_to_date: status.upToDate && shimUpToDate,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "install_failed", detail: message }, 409);
    }
  });

  app.post("/hooks/uninstall", async (c) => {
    const project = c.get("project");
    const raw = await c.req.json().catch(() => null) as { repo_id?: unknown } | null;
    const repoId = typeof raw?.repo_id === "string" ? raw.repo_id : "";
    if (!repoId) return c.json({ error: "missing_repo_id" }, 400);

    const repo = listRepos(project.backlogDir).find((candidate) => candidate.id === repoId);
    if (!repo) return c.json({ error: "unknown_repo", repo_id: repoId }, 404);
    const checkoutPath = repoCheckoutPath(repo);
    if (!checkoutPath) return c.json({ error: "repository_has_no_local_checkout", repo_id: repoId }, 400);

    const repoPath = resolveRepoPath(project.root, checkoutPath);
    const gitDir = findGitDir(repoPath);
    if (!gitDir) return c.json({ error: "not_a_git_repo", repo_id: repoId, repo_path: repoPath }, 400);

    try {
      const removed = uninstallPreCommitHook(gitDir);
      const shimProjectRoot = pickLocalShimProjectRoot(project.root, [repoPath]);
      const backlogBin = path.join(project.backlogDir, "bin", "backlog");
      const status = inspectPreCommitHook(gitDir, backlogBin, {
        projectRoot: project.root,
        backlogDir: project.backlogDir,
      });
      const shimUpToDate = isLocalShimUpToDate(project.backlogDir, shimProjectRoot);
      return c.json({
        repo_id: repo.id,
        repo_path: repoPath,
        git_dir: gitDir,
        hook_path: status.hookPath,
        exists: status.exists,
        managed: status.managed,
        installed_version: status.installedVersion ?? null,
        expected_version: PRE_COMMIT_HOOK_VERSION,
        points_to_backlog_bin: status.pointsToBacklogBin,
        shim_up_to_date: shimUpToDate,
        up_to_date: status.upToDate && shimUpToDate,
        removed,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "uninstall_failed", detail: message }, 409);
    }
  });

  return app;
}
