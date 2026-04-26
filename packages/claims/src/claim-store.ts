import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  claimRecordSchema,
  type ClaimRecord,
} from "@backlog/schemas";
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

function readClaimFile(filePath: string): ClaimRecord {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  return claimRecordSchema.parse(raw);
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
}): ClaimRecord {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + (params.ttlMinutes ?? 30) * 60_000);
  const claim: ClaimRecord = {
    version: 1,
    id: `CLM-${now.toISOString().replace(/[:.]/g, "-")}-${crypto.randomBytes(2).toString("hex")}`,
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
    .map((entry) => readClaimFile(path.join(directory, entry)))
    .filter((claim) => !isExpired(claim));
}

export function loadActiveClaim(backlogDir: string, claimId: string): ClaimRecord {
  return readClaimFile(claimFilePath(activeClaimsDir(backlogDir), claimId));
}

export function listArchivedClaims(backlogDir: string): ClaimRecord[] {
  const directory = archiveClaimsDir(backlogDir);
  if (!fs.existsSync(directory)) {
    return [];
  }
  return fs
    .readdirSync(directory)
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => readClaimFile(path.join(directory, entry)))
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
  const activePath = claimFilePath(activeClaimsDir(backlogDir), claimId);
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
    const claim = readClaimFile(filePath);
    if (!isExpired(claim)) {
      continue;
    }
    archiveClaim(backlogDir, claim.id);
    result.archived.push(claim.id);
  }

  return result;
}
