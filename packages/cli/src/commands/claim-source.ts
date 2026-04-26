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
const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");

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

function readSessionTitleFromJsonl(sessionId: string, cwd: string | undefined): string | null {
  if (!cwd) return null;
  const encoded = cwd.replace(/\//g, "-");
  const filePath = path.join(CLAUDE_PROJECTS_DIR, encoded, `${sessionId}.jsonl`);
  if (!fs.existsSync(filePath)) return null;
  try {
    // Stream-read line by line; bail out as soon as we find the first user message.
    // Avoid loading the whole file (sessions can be 5+ MB).
    const fd = fs.openSync(filePath, "r");
    const buffer = Buffer.alloc(64 * 1024);
    let acc = "";
    let bytesRead = 0;
    while ((bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      acc += buffer.subarray(0, bytesRead).toString("utf8");
      let idx = acc.indexOf("\n");
      while (idx >= 0) {
        const line = acc.slice(0, idx);
        acc = acc.slice(idx + 1);
        idx = acc.indexOf("\n");
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line) as Record<string, unknown>;
          if (obj.type !== "user") continue;
          const message = obj.message as { content?: unknown } | undefined;
          if (!message) continue;
          const content = message.content;
          let text = "";
          if (typeof content === "string") {
            text = content;
          } else if (Array.isArray(content)) {
            for (const part of content) {
              if (part && typeof part === "object" && "text" in part && typeof (part as { text?: unknown }).text === "string") {
                text = (part as { text: string }).text;
                break;
              }
            }
          }
          text = text.trim().split("\n")[0]?.trim() ?? "";
          fs.closeSync(fd);
          if (!text) return null;
          return text.length > 80 ? `${text.slice(0, 77)}…` : text;
        } catch {
          // skip malformed lines
        }
      }
    }
    fs.closeSync(fd);
  } catch {
    // ignore
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
  const envModel = process.env.DEFAULT_LLM_MODEL ?? process.env.CLAUDE_MODEL;
  if (envModel) meta.model = envModel;
  const title = readSessionTitleFromJsonl(session.sessionId, session.cwd);
  if (title) meta.session_title = title;
  return meta;
}
