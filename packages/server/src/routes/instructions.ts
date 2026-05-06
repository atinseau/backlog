import { listRepos } from "@backlog/core";
import { repoCheckoutPath } from "@backlog/schemas";
import { Hono } from "hono";
import fs from "node:fs";
import path from "node:path";
import type { AppEnv } from "../project-resolver.js";

const INSTRUCTION_PATHS = [
  "AGENTS.md",
  "AGENTS.MD",
  "CLAUDE.md",
  "CLAUDE.MD",
  "CODEX.md",
  "GEMINI.md",
  ".cursorrules",
  ".github/copilot-instructions.md",
] as const;

const MAX_CONTENT_BYTES = 160_000;

interface InstructionFile {
  scope: "project" | "repository";
  repository_id?: string;
  repository_name?: string;
  root: string;
  path: string;
  relative_path: string;
  name: string;
  size_bytes: number;
  updated_at: string;
  content: string;
  truncated: boolean;
}

function resolveMaybeRelative(root: string, candidate: string): string {
  return path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(root, candidate);
}

function readInstructionFile(root: string, relativePath: string, base: Omit<InstructionFile, "path" | "relative_path" | "name" | "size_bytes" | "updated_at" | "content" | "truncated">): InstructionFile | null {
  const filePath = path.resolve(root, relativePath);
  const rel = path.relative(root, filePath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  if (!fs.existsSync(filePath)) return null;
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) return null;
  const buf = fs.readFileSync(filePath);
  const truncated = buf.byteLength > MAX_CONTENT_BYTES;
  const slice = truncated ? buf.subarray(0, MAX_CONTENT_BYTES) : buf;
  return {
    ...base,
    path: filePath,
    relative_path: rel,
    name: path.basename(filePath),
    size_bytes: stat.size,
    updated_at: stat.mtime.toISOString(),
    content: slice.toString("utf8"),
    truncated,
  };
}

function compareInstructionFiles(a: InstructionFile, b: InstructionFile): number {
  const scope = a.scope.localeCompare(b.scope);
  if (scope !== 0) return scope;
  const repo = (a.repository_name ?? "").localeCompare(b.repository_name ?? "", undefined, { numeric: true, sensitivity: "base" });
  if (repo !== 0) return repo;
  return a.relative_path.localeCompare(b.relative_path, undefined, { numeric: true, sensitivity: "base" });
}

export function instructionsRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/instructions", (c) => {
    const project = c.get("project");
    const files: InstructionFile[] = [];
    const seen = new Set<string>();

    const pushRoot = (root: string, base: Omit<InstructionFile, "path" | "relative_path" | "name" | "size_bytes" | "updated_at" | "content" | "truncated">) => {
      const resolvedRoot = path.resolve(root);
      for (const candidate of INSTRUCTION_PATHS) {
        const file = readInstructionFile(resolvedRoot, candidate, { ...base, root: resolvedRoot });
        if (!file) continue;
        const key = file.path;
        if (seen.has(key)) continue;
        seen.add(key);
        files.push(file);
      }
    };

    pushRoot(project.root, { scope: "project", root: project.root });

    for (const repo of listRepos(project.backlogDir)) {
      const checkout = repoCheckoutPath(repo);
      if (!checkout) continue;
      const repoRoot = resolveMaybeRelative(project.root, checkout);
      pushRoot(repoRoot, {
        scope: "repository",
        repository_id: repo.id,
        repository_name: (repo as { name?: string }).name ?? repo.id,
        root: repoRoot,
      });
    }

    files.sort(compareInstructionFiles);
    return c.json({ generated_at: new Date().toISOString(), files });
  });

  return app;
}
