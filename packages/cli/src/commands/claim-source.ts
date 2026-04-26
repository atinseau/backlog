// Auto-detection of the agent tool that spawned the CLI. Used by
// `backlog claim start` to populate metadata so a board user can later
// trace a claim back to the conversation that produced it.

import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

interface ClaudeSessionInfo {
  pid: number;
  sessionId: string;
  cwd?: string;
  startedAt?: number;
  version?: string;
  kind?: string;
  entrypoint?: string;
}

const CLAUDE_SESSIONS_DIR = path.join(os.homedir(), ".claude", "sessions");
const CLAUDE_CODE_SESSIONS_DIR = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "Claude",
  "claude-code-sessions",
);

function readClaudeSessionForPid(pid: number): ClaudeSessionInfo | null {
  const filePath = path.join(CLAUDE_SESSIONS_DIR, `${pid}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    const json = JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
    if (typeof json.sessionId === "string") {
      return json as unknown as ClaudeSessionInfo;
    }
  } catch {
    // ignore — bad json or permission error
  }
  return null;
}

function getParentPid(pid: number): number | null {
  try {
    const out = execSync(`ps -o ppid= -p ${pid}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const ppid = Number.parseInt(out, 10);
    return Number.isInteger(ppid) && ppid > 0 && ppid !== 1 ? ppid : null;
  } catch {
    return null;
  }
}

function detectClaudeCodeSession(maxDepth = 8): ClaudeSessionInfo | null {
  if (!fs.existsSync(CLAUDE_SESSIONS_DIR)) return null;
  let pid: number | null = process.pid;
  let depth = 0;
  while (pid !== null && depth < maxDepth) {
    const info = readClaudeSessionForPid(pid);
    if (info) return info;
    pid = getParentPid(pid);
    depth += 1;
  }
  return null;
}

interface ClaudeCodeSessionMetadata {
  title?: string;
  titleSource?: string;
  model?: string;
  effort?: string;
}

/**
 * Walk ~/Library/Application Support/Claude/claude-code-sessions/<...>/<...>.json
 * looking for the file whose `cliSessionId` matches the requested session UUID.
 * Returns the parsed metadata (title, model, effort) when found, null otherwise.
 *
 * Performance note: the tree typically holds tens-to-low-hundreds of files; we
 * sort by mtime desc so a freshly-active session is found in O(1) reads.
 */
function findClaudeCodeSessionMetadata(sessionId: string): ClaudeCodeSessionMetadata | null {
  if (!fs.existsSync(CLAUDE_CODE_SESSIONS_DIR)) return null;
  const candidates: { filePath: string; mtimeMs: number }[] = [];
  const stack: string[] = [CLAUDE_CODE_SESSIONS_DIR];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && entry.name.endsWith(".json")) {
        try {
          const stat = fs.statSync(full);
          candidates.push({ filePath: full, mtimeMs: stat.mtimeMs });
        } catch {
          // skip
        }
      }
    }
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const candidate of candidates) {
    try {
      const json = JSON.parse(fs.readFileSync(candidate.filePath, "utf8")) as Record<string, unknown>;
      if (json.cliSessionId !== sessionId) continue;
      const result: ClaudeCodeSessionMetadata = {};
      if (typeof json.title === "string" && json.title.trim()) result.title = json.title.trim();
      if (typeof json.titleSource === "string") result.titleSource = json.titleSource;
      if (typeof json.model === "string") result.model = json.model;
      if (typeof json.effort === "string") result.effort = json.effort;
      return result;
    } catch {
      // bad json or read error — keep scanning
    }
  }
  return null;
}

/**
 * Auto-derive metadata describing what tool/session triggered this CLI invocation.
 * Returns an empty record when nothing could be detected. Currently recognises
 * Anthropic Claude Code (Desktop or claude-code) by walking the parent process
 * chain looking for `~/.claude/sessions/<pid>.json`.
 */
export function detectClaimSourceMetadata(): Record<string, string> {
  const session = detectClaudeCodeSession();
  if (!session) return {};
  const meta: Record<string, string> = {
    source: "claude-code",
    session_id: session.sessionId,
  };
  if (session.entrypoint) meta.entrypoint = session.entrypoint;
  if (session.cwd) meta.session_cwd = session.cwd;
  // Prefer the cached session metadata (it has the model the runner is
  // actually using, plus the AI-generated title) over the env defaults.
  const cached = findClaudeCodeSessionMetadata(session.sessionId);
  if (cached?.model) {
    meta.model = cached.model;
  } else {
    const envModel = process.env.DEFAULT_LLM_MODEL ?? process.env.CLAUDE_MODEL;
    if (envModel) meta.model = envModel;
  }
  if (cached?.effort) meta.effort = cached.effort;
  // Only attach a title when Claude Code has computed and cached one — no
  // fallback to the first user message, which is just noisy raw text.
  if (cached?.title) meta.session_title = cached.title;
  return meta;
}
