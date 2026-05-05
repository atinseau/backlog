import fs from "node:fs";
import path from "node:path";
import {
  claimRecordSchema,
  type ClaimRecord,
} from "@backlog/schemas";
import { nextId } from "@backlog/config";
import { scopesOverlap } from "./overlap-detector.js";

function activeClaimsDir(backlogDir: string): string {
  return path.join(backlogDir, "claims", "active");
}

function archiveClaimsDir(backlogDir: string): string {
  return path.join(backlogDir, "claims", "archive");
}

function claimFilePath(directory: string, claimId: string): string {
  return path.join(directory, `${claimId}.json`);
}

const warnedUnreadableClaimFiles = new Set<string>();

function findClaimFilePath(directory: string, claimId: string): string | null {
  const direct = claimFilePath(directory, claimId);
  if (fs.existsSync(direct)) return direct;
  if (!fs.existsSync(directory)) return null;
  for (const entry of fs.readdirSync(directory).filter((candidate) => candidate.endsWith(".json"))) {
    const filePath = path.join(directory, entry);
    const claim = readClaimFileIfValid(filePath);
    if (claim?.id === claimId) return filePath;
  }
  return null;
}

function readClaimFile(filePath: string): ClaimRecord {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  return claimRecordSchema.parse(raw);
}

function readClaimFileIfValid(filePath: string): ClaimRecord | null {
  try {
    return readClaimFile(filePath);
  } catch (error) {
    if (!warnedUnreadableClaimFiles.has(filePath)) {
      warnedUnreadableClaimFiles.add(filePath);
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`backlog: ignoring unreadable claim file ${filePath}: ${message}`);
    }
    return null;
  }
}

export function isExpired(claim: ClaimRecord): boolean {
  return new Date(claim.expires_at).getTime() <= Date.now();
}

export function createClaim(params: {
  backlogDir: string;
  repo: string;
  repoPath: string;
  topic: string;
  paths: string[];
  mode?: "exclusive" | "shared";
  ttlMinutes?: number;
  expectedDurationSeconds?: number;
  agentId?: string;
  metadata?: Record<string, string>;
}): ClaimRecord {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + (params.ttlMinutes ?? 30) * 60_000);
  const claim: ClaimRecord = {
    version: 1,
    id: nextId(params.backlogDir, "claim"),
    repo: params.repo,
    repo_path: params.repoPath,
    paths: params.paths,
    mode: params.mode ?? "exclusive",
    status: "active",
    topic: params.topic,
    created_at: now.toISOString(),
    heartbeat_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
  };
  if (params.expectedDurationSeconds !== undefined) {
    claim.expected_duration_seconds = params.expectedDurationSeconds;
    claim.expected_finish_at = new Date(
      now.getTime() + params.expectedDurationSeconds * 1000,
    ).toISOString();
  }
  if (params.agentId !== undefined) {
    claim.agent_id = params.agentId;
  }
  if (params.metadata && Object.keys(params.metadata).length > 0) {
    claim.metadata = params.metadata;
  }

  fs.writeFileSync(
    claimFilePath(activeClaimsDir(params.backlogDir), claim.id),
    JSON.stringify(claim, null, 2) + "\n",
    "utf8",
  );
  return claim;
}

export function listActiveClaims(backlogDir: string): ClaimRecord[] {
  const directory = activeClaimsDir(backlogDir);
  if (!fs.existsSync(directory)) {
    return [];
  }

  return fs
    .readdirSync(directory)
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => readClaimFileIfValid(path.join(directory, entry)))
    .filter((claim): claim is ClaimRecord => claim !== null)
    .filter((claim) => !isExpired(claim));
}

export function loadActiveClaim(backlogDir: string, claimId: string): ClaimRecord {
  const filePath = findClaimFilePath(activeClaimsDir(backlogDir), claimId);
  if (!filePath) throw new Error(`Unknown claim: ${claimId}`);
  return readClaimFile(filePath);
}

// Like loadActiveClaim, but returns null if the on-disk file is missing
// rather than throwing a raw ENOENT. Use this from callers that hold a
// pointer to a claim id (e.g. .git/backlog-context.json) and need to
// distinguish "stale pointer" from real errors.
export function loadActiveClaimIfPresent(backlogDir: string, claimId: string): ClaimRecord | null {
  const filePath = findClaimFilePath(activeClaimsDir(backlogDir), claimId);
  if (!filePath) return null;
  return readClaimFile(filePath);
}

export function listArchivedClaims(backlogDir: string): ClaimRecord[] {
  const directory = archiveClaimsDir(backlogDir);
  if (!fs.existsSync(directory)) {
    return [];
  }
  return fs
    .readdirSync(directory)
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => readClaimFileIfValid(path.join(directory, entry)))
    .filter((claim): claim is ClaimRecord => claim !== null)
    .sort((a, b) => Date.parse(b.finished_at ?? b.expires_at) - Date.parse(a.finished_at ?? a.expires_at));
}

export function findOverlappingClaims(
  backlogDir: string,
  claim: Pick<ClaimRecord, "id" | "repo" | "repo_path" | "paths" | "mode">,
): ClaimRecord[] {
  return listActiveClaims(backlogDir).filter((candidate) => {
    if (candidate.id === claim.id) {
      return false;
    }
    if (candidate.repo !== claim.repo || candidate.repo_path !== claim.repo_path) {
      return false;
    }
    if (candidate.mode === "shared" && claim.mode === "shared") {
      return false;
    }
    return candidate.paths.some((left) => claim.paths.some((right) => scopesOverlap(left, right)));
  });
}

export function archiveClaim(backlogDir: string, claimId: string): ClaimRecord {
  const activePath = findClaimFilePath(activeClaimsDir(backlogDir), claimId);
  if (!activePath) throw new Error(`Unknown claim: ${claimId}`);
  const claim = loadActiveClaim(backlogDir, claimId);
  const archived: ClaimRecord = {
    ...claim,
    status: "archived",
    finished_at: new Date().toISOString(),
  };
  fs.writeFileSync(
    claimFilePath(archiveClaimsDir(backlogDir), claimId),
    JSON.stringify(archived, null, 2) + "\n",
    "utf8",
  );
  fs.unlinkSync(activePath);
  return archived;
}

export interface ClaimGcResult {
  archived: string[];
}

export function garbageCollectExpiredClaims(backlogDir: string): ClaimGcResult {
  const directory = activeClaimsDir(backlogDir);
  const result: ClaimGcResult = {
    archived: [],
  };
  if (!fs.existsSync(directory)) {
    return result;
  }

  for (const entry of fs.readdirSync(directory).filter((candidate) => candidate.endsWith(".json"))) {
    const filePath = path.join(directory, entry);
    const claim = readClaimFileIfValid(filePath);
    if (!claim) {
      continue;
    }
    if (!isExpired(claim)) {
      continue;
    }
    archiveClaim(backlogDir, claim.id);
    result.archived.push(claim.id);
  }

  return result;
}

export interface ContextPointerGcResult {
  // Repositories that had a .git/backlog-context.json before we ran. Useful for
  // "checked N repos, found M orphans" reporting.
  scanned: number;
  // Pointers that referenced a claim_id no longer in claims/active/. We
  // remove these because they would otherwise crash `backlog claim check`
  // with a raw ENOENT when the pre-commit hook fires next.
  removed: { repoRoot: string; claimId: string }[];
}

// Scan each repo's .git/backlog-context.json and remove the ones that
// reference a claim that doesn't exist in claims/active/ anymore (archived,
// gc'd, or moved by `backlog project migrate`). Errors reading individual
// pointers are skipped — one malformed pointer shouldn't abort the sweep.
export function gcOrphanContextPointers(params: {
  backlogDir: string;
  // List of repo roots (paths). Caller usually passes
  // loadConfig(backlogDir).repos.map(r => r.path).
  repoRoots: string[];
}): ContextPointerGcResult {
  const result: ContextPointerGcResult = { scanned: 0, removed: [] };
  for (const repoRoot of params.repoRoots) {
    const contextPath = path.join(repoRoot, ".git", "backlog-context.json");
    if (!fs.existsSync(contextPath)) continue;
    result.scanned++;
    let claimId: string | undefined;
    try {
      const raw = JSON.parse(fs.readFileSync(contextPath, "utf8")) as { claim_id?: unknown };
      if (typeof raw.claim_id === "string") claimId = raw.claim_id;
    } catch {
      // Malformed pointer — leave it alone; the user can clean it up.
      continue;
    }
    if (!claimId) continue;
    const claimFile = claimFilePath(activeClaimsDir(params.backlogDir), claimId);
    if (fs.existsSync(claimFile)) continue;
    fs.unlinkSync(contextPath);
    result.removed.push({ repoRoot, claimId });
  }
  return result;
}
