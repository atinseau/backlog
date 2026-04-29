import { Hono } from "hono";
import fs from "node:fs";
import path from "node:path";
import { execaSync } from "execa";
import type { AppEnv } from "../project-resolver.js";

// Folder inspector endpoint — backs the "create project / add repo"
// dialog so it can pre-fill sensible defaults from the folder the user
// just picked. Reads the filesystem + a small set of git plumbing
// commands; does NOT mutate anything.

interface FolderInspect {
  exists: boolean;
  is_directory: boolean;
  is_git_repo: boolean;
  has_backlog_dir: boolean;
  basename: string;
  current_branch: string | null;
  branches: string[];
}

function safeGit(cwd: string, args: string[]): string | null {
  try {
    const result = execaSync("git", args, { cwd, reject: false, timeout: 3000 });
    if (result.exitCode !== 0) return null;
    return result.stdout.trim();
  } catch {
    return null;
  }
}

export function foldersRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/folders/inspect", (c) => {
    const target = c.req.query("path");
    if (!target || !path.isAbsolute(target)) {
      return c.json({ error: "absolute_path_required" }, 400);
    }
    const out: FolderInspect = {
      exists: false,
      is_directory: false,
      is_git_repo: false,
      has_backlog_dir: false,
      basename: path.basename(target),
      current_branch: null,
      branches: [],
    };
    if (!fs.existsSync(target)) return c.json(out);
    out.exists = true;
    out.is_directory = fs.statSync(target).isDirectory();
    if (!out.is_directory) return c.json(out);

    out.has_backlog_dir = fs.existsSync(path.join(target, ".backlog"));

    const gitDir = path.join(target, ".git");
    if (fs.existsSync(gitDir)) {
      out.is_git_repo = true;
      const head = safeGit(target, ["rev-parse", "--abbrev-ref", "HEAD"]);
      if (head && head !== "HEAD") out.current_branch = head;
      const list = safeGit(target, [
        "for-each-ref",
        "--format=%(refname:short)",
        "--sort=-committerdate",
        "refs/heads",
      ]);
      if (list) {
        out.branches = list
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .slice(0, 30);
      }
      // Make sure the current branch is first in the list even if it
      // hasn't been touched recently.
      if (out.current_branch && !out.branches.includes(out.current_branch)) {
        out.branches = [out.current_branch, ...out.branches];
      }
    }

    return c.json(out);
  });

  return app;
}
