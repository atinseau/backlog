import { listRepos } from "@backlog/core";
import { inspectPreCommitHook, readPauseUntil } from "@backlog/hooks";
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
  points_to_backlog_bin: boolean;
}

interface HooksOverview {
  workspace_paused_until: string | null;
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

export function hooksRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/hooks/status", (c) => {
    const workspace = c.get("workspace");
    const repos = listRepos(workspace.backlogDir);

    const out: HookStatus[] = [];
    for (const repo of repos) {
      const repoPath = path.isAbsolute(repo.path)
        ? repo.path
        : path.resolve(workspace.root, repo.path);
      const gitDir = findGitDir(repoPath);
      if (!gitDir) {
        out.push({
          repo_id: repo.id,
          repo_path: repoPath,
          git_dir: "",
          hook_path: "",
          exists: false,
          managed: false,
          points_to_backlog_bin: false,
        });
        continue;
      }
      const status = inspectPreCommitHook(gitDir);
      out.push({
        repo_id: repo.id,
        repo_path: repoPath,
        git_dir: gitDir,
        hook_path: status.hookPath,
        exists: status.exists,
        managed: status.managed,
        points_to_backlog_bin: status.pointsToBacklogBin,
      });
    }

    const pause = readPauseUntil(workspace.backlogDir);
    const overview: HooksOverview = {
      workspace_paused_until: pause,
      hooks: out,
    };
    return c.json(overview);
  });

  return app;
}
