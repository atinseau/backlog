import { loadConfig } from "@backlog/config";
import { git } from "@backlog/git";
import { Hono } from "hono";
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

const TASK_RE = /\b(WI|TK)-[0-9a-f]{8}\b/gi;
const SUBTASK_RE = /\b(ST|SUB)-[0-9a-f]{8}\b/gi;
const CLAIM_RE = /\bCLM-[0-9TZ:.\-]+-[0-9a-f]{4}\b/g;

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

export function commitsRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/commits", async (c) => {
    const project = c.get("workspace");
    const limit = Math.min(200, Math.max(1, Number.parseInt(c.req.query("limit") ?? "50", 10) || 50));
    const config = loadConfig(project.backlogDir);

    const all: CommitEntry[] = [];
    for (const repo of config.repos) {
      if (!repo.enabled) continue;
      const commits = await readCommitsForRepo(repo.id, repo.path, limit);
      all.push(...commits);
    }
    // Sort by date desc, taking only `limit` overall.
    all.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    return c.json({ commits: all.slice(0, limit) });
  });

  return app;
}
