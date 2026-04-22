import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  claimRecordSchema,
  type ClaimRecord,
} from "@cockpit-ai/schemas";
import { scopesOverlap } from "./overlap-detector.js";

function activeClaimsDir(cockpitDir: string): string {
  return path.join(cockpitDir, "claims", "active");
}

function archiveClaimsDir(cockpitDir: string): string {
  return path.join(cockpitDir, "claims", "archive");
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
  cockpitDir: string;
  repo: string;
  repoPath: string;
  topic: string;
  paths: string[];
  mode?: "exclusive" | "shared";
  ttlMinutes?: number;
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

  fs.writeFileSync(
    claimFilePath(activeClaimsDir(params.cockpitDir), claim.id),
    JSON.stringify(claim, null, 2) + "\n",
    "utf8",
  );
  return claim;
}

export function listActiveClaims(cockpitDir: string): ClaimRecord[] {
  const directory = activeClaimsDir(cockpitDir);
  if (!fs.existsSync(directory)) {
    return [];
  }

  return fs
    .readdirSync(directory)
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => readClaimFile(path.join(directory, entry)))
    .filter((claim) => !isExpired(claim));
}

export function loadActiveClaim(cockpitDir: string, claimId: string): ClaimRecord {
  return readClaimFile(claimFilePath(activeClaimsDir(cockpitDir), claimId));
}

export function findOverlappingClaims(
  cockpitDir: string,
  claim: Pick<ClaimRecord, "id" | "repo" | "repo_path" | "paths" | "mode">,
): ClaimRecord[] {
  return listActiveClaims(cockpitDir).filter((candidate) => {
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

export function archiveClaim(cockpitDir: string, claimId: string): ClaimRecord {
  const activePath = claimFilePath(activeClaimsDir(cockpitDir), claimId);
  const claim = loadActiveClaim(cockpitDir, claimId);
  const archived: ClaimRecord = {
    ...claim,
    status: "archived",
    finished_at: new Date().toISOString(),
  };
  fs.writeFileSync(
    claimFilePath(archiveClaimsDir(cockpitDir), claimId),
    JSON.stringify(archived, null, 2) + "\n",
    "utf8",
  );
  fs.unlinkSync(activePath);
  return archived;
}
