import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import { loadRun } from "@backlog/core";
import type { AppEnv } from "../project-resolver.js";

interface SpawnResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

// Lightweight wrapper so we don't pull in execa just for git invocations.
// Combined output is bounded — diffs >2MB are truncated, which beats
// hanging the SSE channel on a runaway git command.
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
function runGit(args: string[], cwd: string): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const child = spawn("git", args, { cwd });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < MAX_OUTPUT_BYTES) stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_OUTPUT_BYTES) stderr += chunk.toString();
    });
    child.on("error", () => resolve({ exitCode: null, stdout, stderr }));
    child.on("close", (code) => resolve({ exitCode: code, stdout, stderr }));
  });
}

// `git diff` against the worktree's base branch (the branch the
// worktree was created from). For backlog runs we use `main` as a
// pragmatic default — backlog-created branches always fork from
// main. If the file isn't tracked yet we fall back to a synthetic
// "new file" diff against /dev/null so the panel always shows
// something instead of an empty body.
const DEFAULT_BASE = "main";

interface DiffResult {
  run_id: string;
  file: string;
  base: string;
  head: string;
  diff: string;
  content?: string;
  content_empty?: boolean;
  view: "content" | "diff";
  // null when there's no diff (file unchanged), or when the path is
  // outside the worktree / doesn't exist yet.
  empty: boolean;
}

function safeRelativePath(worktreeRoot: string, requested: string): string | null {
  // Reject absolute paths that escape the worktree, and anything
  // containing `..` segments. The activity banner sends repo-relative
  // paths but the check belongs here, not on the client.
  if (path.isAbsolute(requested)) {
    const rel = path.relative(worktreeRoot, requested);
    if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
    return rel;
  }
  if (requested.split(path.sep).some((seg) => seg === "..")) return null;
  return requested;
}

function readTextFile(worktreeRoot: string, rel: string): { ok: true; content: string } | { ok: false } {
  const target = path.resolve(worktreeRoot, rel);
  const root = path.resolve(worktreeRoot);
  const back = path.relative(root, target);
  if (back.startsWith("..") || path.isAbsolute(back)) return { ok: false };
  try {
    const stat = fs.statSync(target);
    if (!stat.isFile() || stat.size > MAX_OUTPUT_BYTES) return { ok: false };
    const buf = fs.readFileSync(target);
    if (buf.includes(0)) return { ok: false };
    return { ok: true, content: buf.toString("utf8") };
  } catch {
    return { ok: false };
  }
}

export function runDiffRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/runs/:id/diff", async (c) => {
    const project = c.get("project");
    const runId = c.req.param("id");
    const file = c.req.query("file");
    const base = c.req.query("base") ?? DEFAULT_BASE;
    if (!file) {
      return c.json({ error: "missing_file", detail: "Pass ?file=<repo-relative-path>." }, 400);
    }
    const run = loadRun(project.backlogDir, runId);
    if (!run) {
      return c.json({ error: "unknown_run", detail: `No run named '${runId}'.` }, 404);
    }
    const rel = safeRelativePath(run.worktree_path, file);
    if (rel === null) {
      return c.json({ error: "invalid_path", detail: "File path is outside the worktree." }, 400);
    }

    // Resolve the head SHA so the response is reproducible (the user
    // can re-fetch later and know what they were looking at).
    let head = "HEAD";
    const headResult = await runGit(["rev-parse", "HEAD"], run.worktree_path);
    if (headResult.exitCode === 0 && headResult.stdout.trim()) {
      head = headResult.stdout.trim().slice(0, 7);
    }

    // Try `git diff <base>... -- <file>` first (covers committed +
    // uncommitted changes since the worktree branched off base).
    // Fall back to `git diff -- <file>` for runs that haven't
    // committed yet but have working-tree edits, then to `git diff
    // --no-index /dev/null <file>` for new untracked files.
    try {
      const content = readTextFile(run.worktree_path, rel);
      if (content.ok) {
        const result: DiffResult = {
          run_id: runId,
          file: rel,
          base,
          head,
          diff: "",
          content: content.content,
          content_empty: content.content.length === 0,
          view: "content",
          empty: content.content.length === 0,
        };
        return c.json(result);
      }

      let body = (await runGit(["diff", `${base}...`, "--", rel], run.worktree_path)).stdout;
      if (!body.trim()) {
        body = (await runGit(["diff", "--", rel], run.worktree_path)).stdout;
      }
      if (!body.trim()) {
        body = (await runGit(["diff", "--no-index", "--", "/dev/null", rel], run.worktree_path)).stdout;
      }
      const result: DiffResult = {
        run_id: runId,
        file: rel,
        base,
        head,
        diff: body,
        view: "diff",
        empty: !body.trim(),
      };
      return c.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "diff_failed", detail: message }, 500);
    }
  });

  return app;
}
