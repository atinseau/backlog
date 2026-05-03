import path from "node:path";
import { loadConfig } from "@backlog/config";
import {
  git,
  listWorkingTreeChanges,
  summarizeGitStatusEntries,
  type GitStatusEntry,
  type GitWorkingTreeStatus,
} from "@backlog/git";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../project-resolver.js";

export interface CommitLink {
  kind: "task" | "subtask" | "claim";
  id: string;
}

export interface CommitEntry {
  repo: string;
  sha: string;
  short_sha: string;
  subject: string;
  author: string;
  date: string;
  links: CommitLink[];
}

export interface GitRepoChanges {
  repo: string;
  path: string;
  status: GitWorkingTreeStatus & { error?: string };
  changes: GitStatusEntry[];
}

export interface GitBranchEntry {
  name: string;
  current: boolean;
  upstream?: string | null;
}

export interface GitRemoteBranchEntry {
  name: string;
  remote: string;
  short_name: string;
}

export interface GitRepoBranches {
  repo: string;
  path: string;
  default_branch: string;
  current_branch: string | null;
  local: GitBranchEntry[];
  remote: GitRemoteBranchEntry[];
  error?: string;
}

export interface GitBranchPreview {
  repo: string;
  source: string;
  target: string;
  base: string;
  commits: CommitEntry[];
  files: CommitFileEntry[];
}

export interface GitWorktreeEntry {
  path: string;
  head: string | null;
  branch: string | null;
  detached: boolean;
  bare: boolean;
  prunable: boolean;
  prunable_reason?: string;
  main: boolean;
}

export interface GitRepoWorktrees {
  repo: string;
  path: string;
  worktrees: GitWorktreeEntry[];
  error?: string;
}

export interface CommitFileEntry {
  path: string;
  old_path?: string;
  kind: "added" | "modified" | "deleted" | "renamed";
}

const commitBodySchema = z.object({
  repo: z.string().min(1),
  paths: z.array(z.string().min(1)).min(1),
  message: z.string().min(1),
});

const gitPathsBodySchema = z.object({
  repo: z.string().min(1),
  paths: z.array(z.string().min(1)).min(1),
});

const stashBodySchema = gitPathsBodySchema.extend({
  message: z.string().trim().min(1).optional(),
});

const syncBodySchema = z.object({
  repo: z.string().min(1),
});

const checkoutBranchBodySchema = z.object({
  repo: z.string().min(1),
  branch: z.string().min(1),
  create: z.boolean().optional(),
  start_point: z.string().min(1).optional(),
});

const mergeBranchBodySchema = z.object({
  repo: z.string().min(1),
  source: z.string().min(1),
  strategy: z.enum(["auto", "ff_only", "no_ff"]).default("auto"),
});

const addWorktreeBodySchema = z.object({
  repo: z.string().min(1),
  path: z.string().min(1),
  branch: z.string().min(1).optional(),
});

const removeWorktreeBodySchema = z.object({
  repo: z.string().min(1),
  path: z.string().min(1),
  force: z.boolean().optional(),
});

function safeRelativePath(requested: string): string | null {
  if (path.isAbsolute(requested)) return null;
  if (requested.split(/[\\/]/).some((segment) => segment === "..")) return null;
  return requested;
}

function safeRequestedPathspecs(requestedPaths: string[], entries: GitStatusEntry[] = []): string[] | null {
  const values = new Set<string>();
  for (const requested of requestedPaths) {
    const safe = safeRelativePath(requested);
    if (!safe) return null;
    values.add(safe);
  }
  for (const entry of entries) {
    if (!entry.old_path) continue;
    const safe = safeRelativePath(entry.old_path);
    if (!safe) return null;
    values.add(safe);
  }
  return [...values];
}

function selectedChanges(changes: GitStatusEntry[], requestedPaths: string[]): GitStatusEntry[] | null {
  const safeRequested = requestedPaths.map((entry) => safeRelativePath(entry));
  if (safeRequested.some((entry) => !entry)) return null;
  const changesByPath = new Map(changes.map((change) => [change.path, change]));
  return [...new Set(safeRequested.filter((entry): entry is string => Boolean(entry)))]
    .map((entry) => changesByPath.get(entry))
    .filter((entry): entry is GitStatusEntry => Boolean(entry));
}

async function discardSelectedChanges(repoPath: string, pathspecs: string[]): Promise<void> {
  if (pathspecs.length === 0) return;
  await git(["reset", "HEAD", "--", ...pathspecs], repoPath);
  for (const pathspec of pathspecs) {
    await git(["checkout", "--", pathspec], repoPath).catch(() => undefined);
  }
  await git(["clean", "-fd", "--", ...pathspecs], repoPath);
}

async function resolveCommit(repoPath: string, requested: string): Promise<string> {
  return git(["rev-parse", "--verify", `${requested}^{commit}`], repoPath);
}

async function gitOrNull(args: string[], cwd: string): Promise<string | null> {
  try {
    return await git(args, cwd);
  } catch {
    return null;
  }
}

async function validateBranchName(repoPath: string, branch: string): Promise<void> {
  await git(["check-ref-format", "--branch", branch], repoPath);
}

async function branchExists(repoPath: string, ref: string): Promise<boolean> {
  return Boolean(await gitOrNull(["rev-parse", "--verify", `${ref}^{commit}`], repoPath));
}

async function readBranchState(repoId: string, repoPath: string, defaultBranch: string): Promise<GitRepoBranches> {
  const currentRaw = await gitOrNull(["rev-parse", "--abbrev-ref", "HEAD"], repoPath);
  const current = currentRaw && currentRaw !== "HEAD" ? currentRaw : null;
  const localRaw = await gitOrNull(["for-each-ref", "--format=%(refname:short)%09%(upstream:short)", "refs/heads"], repoPath);
  const remoteRaw = await gitOrNull(["for-each-ref", "--format=%(refname:short)", "refs/remotes"], repoPath);
  const local: GitBranchEntry[] = (localRaw ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name = "", upstream = ""] = line.split("\t");
      return { name, current: name === current, upstream: upstream || null };
    });
  const remote: GitRemoteBranchEntry[] = (remoteRaw ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((name) => name.includes("/"))
    .filter((name) => !name.endsWith("/HEAD"))
    .map((name) => {
      const slash = name.indexOf("/");
      const remoteName = slash === -1 ? "" : name.slice(0, slash);
      const shortName = slash === -1 ? name : name.slice(slash + 1);
      return { name, remote: remoteName, short_name: shortName };
    });
  return {
    repo: repoId,
    path: repoPath,
    default_branch: defaultBranch,
    current_branch: current,
    local,
    remote,
  };
}

async function readRemoteState(repoPath: string) {
  const branch = await gitOrNull(["rev-parse", "--abbrev-ref", "HEAD"], repoPath);
  const upstream = await gitOrNull(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], repoPath);
  const remoteUrl = await gitOrNull(["remote", "get-url", "origin"], repoPath);
  let ahead = 0;
  let behind = 0;
  if (upstream) {
    const counts = await gitOrNull(["rev-list", "--left-right", "--count", "HEAD...@{u}"], repoPath);
    const [left, right] = counts?.split(/\s+/).map((value) => Number.parseInt(value, 10)) ?? [];
    ahead = Number.isFinite(left) ? left! : 0;
    behind = Number.isFinite(right) ? right! : 0;
  }
  return {
    branch,
    upstream,
    remote_url: remoteUrl,
    ahead,
    behind,
    has_upstream: Boolean(upstream),
  };
}

// Sequential per-project ID format introduced in 1.4. The legacy hex
// formats (TASK-c4bdf6ac, ST-9a2f, CLM-…) are no longer recognised —
// existing projects are renamed once via `backlog migrate ids` so
// the parser stays simple. Three-or-more digits to allow growth past
// task_999.
const TASK_RE = /\btask_\d{3,}\b/g;
const SUBTASK_RE = /\bsubtask_\d{3,}\b/g;
const CLAIM_RE = /\bclaim_\d{3,}\b/g;

function detectLinks(message: string): CommitLink[] {
  const links: CommitLink[] = [];
  const seen = new Set<string>();
  for (const match of message.matchAll(TASK_RE)) {
    const id = match[0];
    const key = `task:${id}`;
    if (!seen.has(key)) {
      links.push({ kind: "task", id });
      seen.add(key);
    }
  }
  for (const match of message.matchAll(SUBTASK_RE)) {
    const id = match[0];
    const key = `subtask:${id}`;
    if (!seen.has(key)) {
      links.push({ kind: "subtask", id });
      seen.add(key);
    }
  }
  for (const match of message.matchAll(CLAIM_RE)) {
    const id = match[0];
    const key = `claim:${id}`;
    if (!seen.has(key)) {
      links.push({ kind: "claim", id });
      seen.add(key);
    }
  }
  return links;
}

async function readCommitsForRepo(repoId: string, repoPath: string, limit: number): Promise<CommitEntry[]> {
  // %x1f is unit separator — safer than | which can appear in commit messages.
  const fmt = "%H%x1f%h%x1f%s%x1f%an%x1f%cI";
  let raw = "";
  try {
    raw = await git(["log", `--max-count=${limit}`, `--pretty=format:${fmt}`], repoPath);
  } catch {
    return [];
  }
  if (!raw) return [];
  const lines = raw.split("\n").filter(Boolean);
  return lines.map((line) => {
    const [sha = "", short = "", subject = "", author = "", date = ""] = line.split("\x1f");
    return {
      repo: repoId,
      sha,
      short_sha: short,
      subject,
      author,
      date,
      links: detectLinks(subject),
    };
  });
}

async function readCommitFiles(repoPath: string, sha: string): Promise<CommitFileEntry[]> {
  const commit = await resolveCommit(repoPath, sha);
  const raw = await git(["show", "--name-status", "--format=", "--find-renames", commit], repoPath);
  if (!raw.trim()) return [];
  const files: CommitFileEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const [status = "", first = "", second = ""] = line.split("\t");
    if (!status || !first) continue;
    if (status.startsWith("R")) {
      if (second) files.push({ kind: "renamed", old_path: first, path: second });
      continue;
    }
    if (status.startsWith("A")) files.push({ kind: "added", path: first });
    else if (status.startsWith("D")) files.push({ kind: "deleted", path: first });
    else files.push({ kind: "modified", path: first });
  }
  return files;
}

function parseNameStatus(raw: string): CommitFileEntry[] {
  const files: CommitFileEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const [status = "", first = "", second = ""] = line.split("\t");
    if (!status || !first) continue;
    if (status.startsWith("R")) {
      if (second) files.push({ kind: "renamed", old_path: first, path: second });
      continue;
    }
    if (status.startsWith("A")) files.push({ kind: "added", path: first });
    else if (status.startsWith("D")) files.push({ kind: "deleted", path: first });
    else files.push({ kind: "modified", path: first });
  }
  return files;
}

async function readCommitsInRange(repoId: string, repoPath: string, range: string, limit: number): Promise<CommitEntry[]> {
  const fmt = "%H%x1f%h%x1f%s%x1f%an%x1f%cI";
  const raw = await git(["log", `--max-count=${limit}`, `--pretty=format:${fmt}`, range], repoPath);
  if (!raw) return [];
  return raw.split("\n").filter(Boolean).map((line) => {
    const [sha = "", short = "", subject = "", author = "", date = ""] = line.split("\x1f");
    return {
      repo: repoId,
      sha,
      short_sha: short,
      subject,
      author,
      date,
      links: detectLinks(subject),
    };
  });
}

async function readWorktrees(repoPath: string): Promise<GitWorktreeEntry[]> {
  const raw = await git(["worktree", "list", "--porcelain"], repoPath);
  const records = raw.split(/\n(?=worktree )/).map((record) => record.trim()).filter(Boolean);
  return records.map((record, index) => {
    const out: GitWorktreeEntry = {
      path: "",
      head: null,
      branch: null,
      detached: false,
      bare: false,
      prunable: false,
      main: index === 0,
    };
    for (const line of record.split("\n")) {
      if (line.startsWith("worktree ")) out.path = line.slice("worktree ".length);
      else if (line.startsWith("HEAD ")) out.head = line.slice("HEAD ".length);
      else if (line.startsWith("branch ")) out.branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
      else if (line === "detached") out.detached = true;
      else if (line === "bare") out.bare = true;
      else if (line.startsWith("prunable")) {
        out.prunable = true;
        const reason = line.slice("prunable".length).trim();
        if (reason) out.prunable_reason = reason;
      }
    }
    return out;
  });
}

export function commitsRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/commits", async (c) => {
    const project = c.get("project");
    const limit = Math.min(200, Math.max(1, Number.parseInt(c.req.query("limit") ?? "50", 10) || 50));
    const repoFilter = c.req.query("repo") ?? null;
    const config = loadConfig(project.backlogDir);

    const all: CommitEntry[] = [];
    for (const repo of config.repos) {
      if (!repo.enabled) continue;
      if (repoFilter && repo.id !== repoFilter) continue;
      const commits = await readCommitsForRepo(repo.id, repo.path, limit);
      all.push(...commits);
    }
    // Sort by date desc, taking only `limit` overall.
    all.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    return c.json({ commits: all.slice(0, limit) });
  });

  app.get("/git/changes", async (c) => {
    const project = c.get("project");
    const repoFilter = c.req.query("repo") ?? null;
    const config = loadConfig(project.backlogDir);

    const repos: GitRepoChanges[] = [];
    for (const repo of config.repos) {
      if (!repo.enabled) continue;
      if (repoFilter && repo.id !== repoFilter) continue;
      try {
        const changes = await listWorkingTreeChanges(repo.path);
        repos.push({
          repo: repo.id,
          path: repo.path,
          status: summarizeGitStatusEntries(changes),
          changes,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        repos.push({
          repo: repo.id,
          path: repo.path,
          status: {
            clean: false,
            total: 0,
            added: 0,
            modified: 0,
            deleted: 0,
            renamed: 0,
            untracked: 0,
            conflicted: 0,
            staged: 0,
            unstaged: 0,
            error: message,
          },
          changes: [],
        });
      }
    }
    return c.json({ repos });
  });

  app.get("/git/commit-files", async (c) => {
    const project = c.get("project");
    const repoId = c.req.query("repo");
    const sha = c.req.query("sha");
    if (!repoId || !sha) return c.json({ error: "missing_params" }, 400);
    const config = loadConfig(project.backlogDir);
    const repo = config.repos.find((candidate) => candidate.id === repoId);
    if (!repo) return c.json({ error: "unknown_repo" }, 404);
    try {
      const commit = await resolveCommit(repo.path, sha);
      const files = await readCommitFiles(repo.path, commit);
      return c.json({ repo: repo.id, sha: commit, files });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "commit_files_failed", detail: message }, 400);
    }
  });

  app.get("/git/diff", async (c) => {
    const project = c.get("project");
    const repoId = c.req.query("repo");
    const file = c.req.query("file");
    const sha = c.req.query("sha");
    const base = c.req.query("base");
    const head = c.req.query("head");
    if (!repoId || !file) return c.json({ error: "missing_params" }, 400);
    const rel = safeRelativePath(file);
    if (!rel) return c.json({ error: "invalid_path" }, 400);
    const config = loadConfig(project.backlogDir);
    const repo = config.repos.find((candidate) => candidate.id === repoId);
    if (!repo) return c.json({ error: "unknown_repo" }, 404);
    try {
      if (base && head) {
        await resolveCommit(repo.path, base);
        await resolveCommit(repo.path, head);
        const rawFiles = await git(["diff", "--name-status", "--find-renames", `${base}...${head}`], repo.path);
        const files = parseNameStatus(rawFiles);
        const change = files.find((candidate) => candidate.path === rel || candidate.old_path === rel);
        const pathspecs = change?.old_path ? [change.old_path, change.path] : [rel];
        const body = await git(["diff", "--find-renames", `${base}...${head}`, "--", ...pathspecs], repo.path);
        return c.json({
          repo: repo.id,
          file: rel,
          base,
          head,
          diff: body,
          empty: !body.trim(),
          kind: change?.kind ?? null,
        });
      }
      if (sha) {
        const commit = await resolveCommit(repo.path, sha);
        const files = await readCommitFiles(repo.path, commit);
        const change = files.find((candidate) => candidate.path === rel || candidate.old_path === rel);
        const pathspecs = change?.old_path ? [change.old_path, change.path] : [rel];
        const body = await git(["show", "--format=", "--find-renames", commit, "--", ...pathspecs], repo.path);
        return c.json({
          repo: repo.id,
          file: rel,
          sha: commit,
          diff: body,
          empty: !body.trim(),
          kind: change?.kind ?? null,
        });
      }
      const changes = await listWorkingTreeChanges(repo.path);
      const change = changes.find((candidate) => candidate.path === rel);
      let body = "";
      if (change?.kind === "untracked") {
        body = await git(["diff", "--no-index", "--", "/dev/null", rel], repo.path).catch((error) => {
          const candidate = error instanceof Error && "stdout" in error ? String((error as { stdout?: string }).stdout ?? "") : "";
          return candidate;
        });
      } else {
        body = await git(["diff", "HEAD", "--", rel], repo.path);
      }
      return c.json({
        repo: repo.id,
        file: rel,
        diff: body,
        empty: !body.trim(),
        kind: change?.kind ?? null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "diff_failed", detail: message }, 500);
    }
  });

  app.get("/git/remote", async (c) => {
    const project = c.get("project");
    const repoFilter = c.req.query("repo") ?? null;
    const config = loadConfig(project.backlogDir);
    const repos = [];
    for (const repo of config.repos) {
      if (!repo.enabled) continue;
      if (repoFilter && repo.id !== repoFilter) continue;
      try {
        repos.push({ repo: repo.id, ...(await readRemoteState(repo.path)) });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        repos.push({ repo: repo.id, branch: null, upstream: null, remote_url: null, ahead: 0, behind: 0, has_upstream: false, error: message });
      }
    }
    return c.json({ repos });
  });

  app.get("/git/branches", async (c) => {
    const project = c.get("project");
    const repoFilter = c.req.query("repo") ?? null;
    const config = loadConfig(project.backlogDir);
    const repos: GitRepoBranches[] = [];
    for (const repo of config.repos) {
      if (!repo.enabled) continue;
      if (repoFilter && repo.id !== repoFilter) continue;
      try {
        repos.push(await readBranchState(repo.id, repo.path, repo.default_branch));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        repos.push({
          repo: repo.id,
          path: repo.path,
          default_branch: repo.default_branch,
          current_branch: null,
          local: [],
          remote: [],
          error: message,
        });
      }
    }
    return c.json({ repos });
  });

  app.get("/git/branch-preview", async (c) => {
    const project = c.get("project");
    const repoId = c.req.query("repo");
    const source = c.req.query("source");
    const target = c.req.query("target") ?? "HEAD";
    if (!repoId || !source) return c.json({ error: "missing_params" }, 400);
    const config = loadConfig(project.backlogDir);
    const repo = config.repos.find((candidate) => candidate.id === repoId);
    if (!repo) return c.json({ error: "unknown_repo" }, 404);

    try {
      await resolveCommit(repo.path, source);
      await resolveCommit(repo.path, target);
      const base = await git(["merge-base", target, source], repo.path);
      const commits = await readCommitsInRange(repo.id, repo.path, `${target}..${source}`, 100);
      const rawFiles = await git(["diff", "--name-status", "--find-renames", `${target}...${source}`], repo.path);
      const files = parseNameStatus(rawFiles);
      const result: GitBranchPreview = { repo: repo.id, source, target, base, commits, files };
      return c.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "branch_preview_failed", detail: message }, 400);
    }
  });

  app.get("/git/worktrees", async (c) => {
    const project = c.get("project");
    const repoFilter = c.req.query("repo") ?? null;
    const config = loadConfig(project.backlogDir);
    const repos: GitRepoWorktrees[] = [];
    for (const repo of config.repos) {
      if (!repo.enabled) continue;
      if (repoFilter && repo.id !== repoFilter) continue;
      try {
        repos.push({ repo: repo.id, path: repo.path, worktrees: await readWorktrees(repo.path) });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        repos.push({ repo: repo.id, path: repo.path, worktrees: [], error: message });
      }
    }
    return c.json({ repos });
  });

  app.post("/git/checkout", async (c) => {
    const project = c.get("project");
    const raw = await c.req.json().catch(() => null);
    const parsed = checkoutBranchBodySchema.safeParse(raw);
    if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);
    const config = loadConfig(project.backlogDir);
    const repo = config.repos.find((candidate) => candidate.id === parsed.data.repo);
    if (!repo) return c.json({ error: "unknown_repo" }, 404);

    try {
      if (parsed.data.create) {
        await validateBranchName(repo.path, parsed.data.branch);
        const startPoint = parsed.data.start_point ?? "HEAD";
        await resolveCommit(repo.path, startPoint);
        await git(["switch", "-c", parsed.data.branch, startPoint], repo.path);
      } else if (await branchExists(repo.path, `refs/heads/${parsed.data.branch}`)) {
        await git(["switch", parsed.data.branch], repo.path);
      } else if (await branchExists(repo.path, `refs/remotes/${parsed.data.branch}`)) {
        const localName = parsed.data.branch.replace(/^[^/]+\//, "");
        await validateBranchName(repo.path, localName);
        if (await branchExists(repo.path, `refs/heads/${localName}`)) {
          await git(["switch", localName], repo.path);
        } else {
          await git(["switch", "--track", parsed.data.branch], repo.path);
        }
      } else {
        await git(["switch", parsed.data.branch], repo.path);
      }
      return c.json({ ok: true, repo: repo.id, state: await readBranchState(repo.id, repo.path, repo.default_branch) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "checkout_failed", detail: message }, 400);
    }
  });

  app.post("/git/merge", async (c) => {
    const project = c.get("project");
    const raw = await c.req.json().catch(() => null);
    const parsed = mergeBranchBodySchema.safeParse(raw);
    if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);
    const config = loadConfig(project.backlogDir);
    const repo = config.repos.find((candidate) => candidate.id === parsed.data.repo);
    if (!repo) return c.json({ error: "unknown_repo" }, 404);

    try {
      await resolveCommit(repo.path, parsed.data.source);
      const current = await gitOrNull(["rev-parse", "--abbrev-ref", "HEAD"], repo.path);
      const args = parsed.data.strategy === "ff_only"
        ? ["merge", "--ff-only", parsed.data.source]
        : parsed.data.strategy === "no_ff"
          ? ["merge", "--no-ff", "-m", `Merge ${parsed.data.source} into ${current ?? "HEAD"}`, parsed.data.source]
          : ["merge", parsed.data.source];
      await git(args, repo.path);
      const sha = await git(["rev-parse", "HEAD"], repo.path);
      return c.json({
        ok: true,
        repo: repo.id,
        sha,
        short_sha: sha.slice(0, 7),
        state: await readBranchState(repo.id, repo.path, repo.default_branch),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "merge_failed", detail: message }, 409);
    }
  });

  app.post("/git/worktrees", async (c) => {
    const project = c.get("project");
    const raw = await c.req.json().catch(() => null);
    const parsed = addWorktreeBodySchema.safeParse(raw);
    if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);
    const config = loadConfig(project.backlogDir);
    const repo = config.repos.find((candidate) => candidate.id === parsed.data.repo);
    if (!repo) return c.json({ error: "unknown_repo" }, 404);

    try {
      const targetPath = path.isAbsolute(parsed.data.path)
        ? parsed.data.path
        : path.resolve(repo.path, parsed.data.path);
      const args = ["worktree", "add", targetPath];
      if (parsed.data.branch) {
        await resolveCommit(repo.path, parsed.data.branch);
        args.push(parsed.data.branch);
      }
      await git(args, repo.path);
      return c.json({ ok: true, repo: repo.id, worktrees: await readWorktrees(repo.path) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "worktree_add_failed", detail: message }, 400);
    }
  });

  app.post("/git/worktrees/remove", async (c) => {
    const project = c.get("project");
    const raw = await c.req.json().catch(() => null);
    const parsed = removeWorktreeBodySchema.safeParse(raw);
    if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);
    const config = loadConfig(project.backlogDir);
    const repo = config.repos.find((candidate) => candidate.id === parsed.data.repo);
    if (!repo) return c.json({ error: "unknown_repo" }, 404);

    try {
      const worktrees = await readWorktrees(repo.path);
      const target = worktrees.find((entry) => entry.path === parsed.data.path);
      if (!target) return c.json({ error: "unknown_worktree" }, 404);
      if (target.main) return c.json({ error: "cannot_remove_main_worktree" }, 400);
      const args = ["worktree", "remove"];
      if (parsed.data.force) args.push("--force");
      args.push(target.path);
      await git(args, repo.path);
      return c.json({ ok: true, repo: repo.id, worktrees: await readWorktrees(repo.path) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "worktree_remove_failed", detail: message }, 400);
    }
  });

  app.post("/git/worktrees/prune", async (c) => {
    const project = c.get("project");
    const raw = await c.req.json().catch(() => null);
    const parsed = syncBodySchema.safeParse(raw);
    if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
    const config = loadConfig(project.backlogDir);
    const repo = config.repos.find((candidate) => candidate.id === parsed.data.repo);
    if (!repo) return c.json({ error: "unknown_repo" }, 404);

    try {
      await git(["worktree", "prune"], repo.path);
      return c.json({ ok: true, repo: repo.id, worktrees: await readWorktrees(repo.path) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "worktree_prune_failed", detail: message }, 400);
    }
  });

  app.post("/git/sync", async (c) => {
    const project = c.get("project");
    const raw = await c.req.json().catch(() => null);
    const parsed = syncBodySchema.safeParse(raw);
    if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
    const config = loadConfig(project.backlogDir);
    const repo = config.repos.find((candidate) => candidate.id === parsed.data.repo);
    if (!repo) return c.json({ error: "unknown_repo" }, 404);

    const actions: string[] = [];
    try {
      await git(["fetch", "--prune"], repo.path);
      actions.push("fetch");
      let state = await readRemoteState(repo.path);
      if (!state.has_upstream) {
        if (state.remote_url && state.branch) {
          await git(["push", "-u", "origin", state.branch], repo.path);
          actions.push("push");
          state = await readRemoteState(repo.path);
        } else {
          return c.json({ error: "missing_upstream", detail: "Set an upstream branch before syncing.", actions, state }, 400);
        }
      }
      if (state.behind > 0) {
        await git(["pull", "--ff-only"], repo.path);
        actions.push("pull");
        state = await readRemoteState(repo.path);
      }
      if (state.ahead > 0) {
        await git(["push"], repo.path);
        actions.push("push");
        state = await readRemoteState(repo.path);
      }
      return c.json({ ok: true, repo: repo.id, actions, state });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "sync_failed", detail: message, actions }, 400);
    }
  });

  app.post("/git/discard", async (c) => {
    const project = c.get("project");
    const raw = await c.req.json().catch(() => null);
    const parsed = gitPathsBodySchema.safeParse(raw);
    if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);

    const config = loadConfig(project.backlogDir);
    const repo = config.repos.find((candidate) => candidate.id === parsed.data.repo);
    if (!repo) return c.json({ error: "unknown_repo" }, 404);

    const changes = await listWorkingTreeChanges(repo.path);
    const selected = selectedChanges(changes, parsed.data.paths);
    if (!selected) return c.json({ error: "invalid_path" }, 400);
    if (selected.length === 0) return c.json({ error: "nothing_to_discard" }, 400);
    if (selected.some((entry) => entry.kind === "conflicted")) {
      return c.json({ error: "conflicted_files", detail: "Resolve conflicts before discarding changes." }, 409);
    }
    const pathspecs = safeRequestedPathspecs(parsed.data.paths, selected);
    if (!pathspecs) return c.json({ error: "invalid_path" }, 400);

    try {
      await discardSelectedChanges(repo.path, pathspecs);
      return c.json({ ok: true, repo: repo.id, discarded: selected.length });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "discard_failed", detail: message }, 400);
    }
  });

  app.post("/git/stash", async (c) => {
    const project = c.get("project");
    const raw = await c.req.json().catch(() => null);
    const parsed = stashBodySchema.safeParse(raw);
    if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);

    const config = loadConfig(project.backlogDir);
    const repo = config.repos.find((candidate) => candidate.id === parsed.data.repo);
    if (!repo) return c.json({ error: "unknown_repo" }, 404);

    const changes = await listWorkingTreeChanges(repo.path);
    const selected = selectedChanges(changes, parsed.data.paths);
    if (!selected) return c.json({ error: "invalid_path" }, 400);
    if (selected.length === 0) return c.json({ error: "nothing_to_stash" }, 400);
    if (selected.some((entry) => entry.kind === "conflicted")) {
      return c.json({ error: "conflicted_files", detail: "Resolve conflicts before stashing changes." }, 409);
    }

    const pathspecs = safeRequestedPathspecs(parsed.data.paths, selected);
    if (!pathspecs) return c.json({ error: "invalid_path" }, 400);
    const message = parsed.data.message ?? "Backlog stash";
    try {
      await git(["stash", "push", "-u", "-m", message, "--", ...pathspecs], repo.path);
      return c.json({ ok: true, repo: repo.id, stashed: selected.length, message });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return c.json({ error: "stash_failed", detail }, 400);
    }
  });

  app.post("/git/commit", async (c) => {
    const project = c.get("project");
    const raw = await c.req.json().catch(() => null);
    const parsed = commitBodySchema.safeParse(raw);
    if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);

    const config = loadConfig(project.backlogDir);
    const repo = config.repos.find((candidate) => candidate.id === parsed.data.repo);
    if (!repo) return c.json({ error: "unknown_repo" }, 404);

    const changes = await listWorkingTreeChanges(repo.path);
    const changesByPath = new Map(changes.map((change) => [change.path, change]));
    const selected = parsed.data.paths.map((entry) => changesByPath.get(entry)).filter((entry): entry is GitStatusEntry => Boolean(entry));
    if (selected.length === 0) {
      return c.json({ error: "nothing_to_commit" }, 400);
    }
    if (selected.some((entry) => entry.kind === "conflicted")) {
      return c.json({ error: "conflicted_files", detail: "Resolve conflicts before committing." }, 409);
    }

    const pathspecs = [...new Set(selected.flatMap((entry) => entry.old_path ? [entry.old_path, entry.path] : [entry.path]))];
    try {
      await git(["add", "-A", "--", ...pathspecs], repo.path);
      await git(["commit", "-m", parsed.data.message.trim(), "--", ...pathspecs], repo.path);
      const sha = await git(["rev-parse", "HEAD"], repo.path);
      return c.json({ ok: true, repo: repo.id, sha, short_sha: sha.slice(0, 7) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "commit_failed", detail: message }, 400);
    }
  });

  return app;
}
