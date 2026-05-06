import { git } from "./git-client.js";

export interface GitWorkingTreeStatus {
  clean: boolean;
  total: number;
  added: number;
  modified: number;
  deleted: number;
  renamed: number;
  untracked: number;
  conflicted: number;
  staged: number;
  unstaged: number;
}

export type GitChangeKind = "added" | "modified" | "deleted" | "renamed" | "untracked" | "conflicted";

export interface GitStatusEntry {
  path: string;
  old_path?: string;
  kind: GitChangeKind;
  index_status: string;
  working_tree_status: string;
  staged: boolean;
  unstaged: boolean;
}

export function emptyGitWorkingTreeStatus(): GitWorkingTreeStatus {
  return {
    clean: true,
    total: 0,
    added: 0,
    modified: 0,
    deleted: 0,
    renamed: 0,
    untracked: 0,
    conflicted: 0,
    staged: 0,
    unstaged: 0,
  };
}

function isConflict(indexStatus: string, workingTreeStatus: string): boolean {
  if (indexStatus === "U" || workingTreeStatus === "U") return true;
  return (indexStatus === "A" && workingTreeStatus === "A")
    || (indexStatus === "D" && workingTreeStatus === "D")
    || (indexStatus === "A" && workingTreeStatus === "U")
    || (indexStatus === "U" && workingTreeStatus === "A")
    || (indexStatus === "D" && workingTreeStatus === "U")
    || (indexStatus === "U" && workingTreeStatus === "D");
}

function classifyEntry(indexStatus: string, workingTreeStatus: string): GitChangeKind | null {
  if (indexStatus === "?" && workingTreeStatus === "?") return "untracked";
  if (indexStatus === "!" && workingTreeStatus === "!") return null;
  if (isConflict(indexStatus, workingTreeStatus)) return "conflicted";
  if (indexStatus === "R" || workingTreeStatus === "R") return "renamed";
  if (indexStatus === "A" || workingTreeStatus === "A" || indexStatus === "C" || workingTreeStatus === "C") {
    return "added";
  }
  if (indexStatus === "D" || workingTreeStatus === "D") return "deleted";
  if (indexStatus === "M" || workingTreeStatus === "M" || indexStatus === "T" || workingTreeStatus === "T") {
    return "modified";
  }
  return null;
}

export function decodeGitQuotedPath(rawPath: string): string {
  if (rawPath.length < 2 || rawPath[0] !== "\"" || rawPath[rawPath.length - 1] !== "\"") {
    return rawPath;
  }
  let out = "";
  let bytes: number[] = [];
  const flushBytes = () => {
    if (bytes.length === 0) return;
    out += new TextDecoder().decode(new Uint8Array(bytes));
    bytes = [];
  };

  for (let i = 1; i < rawPath.length - 1; i += 1) {
    const ch = rawPath[i] ?? "";
    if (ch !== "\\") {
      flushBytes();
      out += ch;
      continue;
    }

    const next = rawPath[i + 1] ?? "";
    if (!next) {
      flushBytes();
      out += "\\";
      continue;
    }
    if (/[0-7]/.test(next)) {
      let octal = next;
      let consumed = 1;
      while (consumed < 3 && /[0-7]/.test(rawPath[i + 1 + consumed] ?? "")) {
        octal += rawPath[i + 1 + consumed];
        consumed += 1;
      }
      bytes.push(Number.parseInt(octal, 8));
      i += consumed;
      continue;
    }

    flushBytes();
    i += 1;
    switch (next) {
      case "a": out += "\u0007"; break;
      case "b": out += "\b"; break;
      case "f": out += "\f"; break;
      case "n": out += "\n"; break;
      case "r": out += "\r"; break;
      case "t": out += "\t"; break;
      case "v": out += "\v"; break;
      case "\\":
      case "\"":
        out += next;
        break;
      default:
        out += next;
        break;
    }
  }
  flushBytes();
  return out;
}

function splitGitRenamePath(rawPath: string): [string, string] | null {
  let quoted = false;
  let escaped = false;
  for (let i = 0; i <= rawPath.length - 4; i += 1) {
    const ch = rawPath[i] ?? "";
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quoted && ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === "\"") {
      quoted = !quoted;
      continue;
    }
    if (!quoted && rawPath.slice(i, i + 4) === " -> ") {
      return [rawPath.slice(0, i), rawPath.slice(i + 4)];
    }
  }
  return null;
}

function parsePath(rawPath: string, kind: GitChangeKind | null): { path: string; old_path?: string } {
  if (kind === "renamed") {
    const renamed = splitGitRenamePath(rawPath);
    if (renamed) {
      const [oldPath, newPath] = renamed;
      if (oldPath && newPath) {
        return { path: decodeGitQuotedPath(newPath), old_path: decodeGitQuotedPath(oldPath) };
      }
    }
  }
  return { path: decodeGitQuotedPath(rawPath) };
}

export function parseGitStatusEntries(output: string): GitStatusEntry[] {
  const entries: GitStatusEntry[] = [];
  for (const rawLine of output.split("\n")) {
    if (!rawLine) continue;
    let indexStatus = rawLine[0] ?? " ";
    let workingTreeStatus = rawLine[1] ?? " ";
    let rawPath = rawLine.slice(3);
    // Be forgiving with callers that already trimmed the porcelain
    // output. In porcelain v1, unstaged-only rows start with a
    // significant leading space, e.g. " M screens/App.ts". If that
    // leading space is lost, the line becomes "M screens/App.ts";
    // parsing with slice(3) would drop the first path character.
    if (rawLine[1] === " " && rawLine[2] && rawLine[2] !== " ") {
      indexStatus = " ";
      workingTreeStatus = rawLine[0] ?? " ";
      rawPath = rawLine.slice(2);
    }
    const kind = classifyEntry(indexStatus, workingTreeStatus);
    if (!kind) continue;
    const parsedPath = parsePath(rawPath, kind);
    entries.push({
      ...parsedPath,
      kind,
      index_status: indexStatus,
      working_tree_status: workingTreeStatus,
      staged: indexStatus !== " " && indexStatus !== "?",
      unstaged: workingTreeStatus !== " " && workingTreeStatus !== "?",
    });
  }
  return entries;
}

export function summarizeGitStatusEntries(entries: GitStatusEntry[]): GitWorkingTreeStatus {
  const status = emptyGitWorkingTreeStatus();
  for (const entry of entries) {
    status[entry.kind] += 1;
    status.total += 1;
    if (entry.staged) status.staged += 1;
    if (entry.unstaged) status.unstaged += 1;
  }
  status.clean = status.total === 0;
  return status;
}

export function parseGitStatusPorcelain(output: string): GitWorkingTreeStatus {
  return summarizeGitStatusEntries(parseGitStatusEntries(output));
}

export async function getWorkingTreeStatus(repoRoot: string): Promise<GitWorkingTreeStatus> {
  const output = await git(["-c", "core.quotePath=false", "status", "--porcelain=v1"], repoRoot);
  return parseGitStatusPorcelain(output);
}

export async function listWorkingTreeChanges(repoRoot: string): Promise<GitStatusEntry[]> {
  const output = await git(["-c", "core.quotePath=false", "status", "--porcelain=v1"], repoRoot);
  return parseGitStatusEntries(output);
}
