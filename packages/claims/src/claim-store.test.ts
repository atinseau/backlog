import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";
import {
  archiveClaim,
  createClaim,
  gcOrphanContextPointers,
  listActiveClaims,
  loadActiveClaim,
  loadActiveClaimIfPresent,
} from "./claim-store.js";

function tmpBacklogDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-claim-store-"));
  fs.mkdirSync(path.join(dir, "claims", "active"), { recursive: true });
  fs.mkdirSync(path.join(dir, "claims", "archive"), { recursive: true });
  return dir;
}

describe("loadActiveClaim / loadActiveClaimIfPresent", () => {
  it("returns the claim when the file exists", () => {
    const backlogDir = tmpBacklogDir();
    const claim = createClaim({
      backlogDir,
      repo: "demo",
      repoPath: "/tmp/demo",
      topic: "feature",
      paths: ["src/**"],
    });

    expect(loadActiveClaim(backlogDir, claim.id).id).toBe(claim.id);
    expect(loadActiveClaimIfPresent(backlogDir, claim.id)?.id).toBe(claim.id);
  });

  it("loadActiveClaimIfPresent returns null on a missing claim file (e.g. stale .git/backlog-context.json after a workspace migration)", () => {
    const backlogDir = tmpBacklogDir();
    expect(loadActiveClaimIfPresent(backlogDir, "CLM-does-not-exist")).toBeNull();
  });

  it("loadActiveClaim still throws on a missing claim — callers that want soft-fail should use loadActiveClaimIfPresent", () => {
    const backlogDir = tmpBacklogDir();
    expect(() => loadActiveClaim(backlogDir, "CLM-does-not-exist")).toThrowError(/Unknown claim/);
  });

  it("finds and archives legacy claim files whose filename differs from the claim id", () => {
    const backlogDir = tmpBacklogDir();
    const claim = createClaim({
      backlogDir,
      repo: "demo",
      repoPath: "/tmp/demo",
      topic: "legacy",
      paths: ["src/**"],
    });
    const canonicalPath = path.join(backlogDir, "claims", "active", `${claim.id}.json`);
    const legacyPath = path.join(backlogDir, "claims", "active", "CLM-legacy-name.json");
    fs.renameSync(canonicalPath, legacyPath);

    expect(loadActiveClaim(backlogDir, claim.id).id).toBe(claim.id);
    archiveClaim(backlogDir, claim.id);
    expect(fs.existsSync(legacyPath)).toBe(false);
    expect(fs.existsSync(path.join(backlogDir, "claims", "archive", `${claim.id}.json`))).toBe(true);
  });
});

describe("listActiveClaims", () => {
  it("quarantines malformed claim files instead of crashing or logging during scans", () => {
    const backlogDir = tmpBacklogDir();
    const claim = createClaim({
      backlogDir,
      repo: "demo",
      repoPath: "/tmp/demo",
      topic: "feature",
      paths: ["src/**"],
    });
    const badPath = path.join(backlogDir, "claims", "active", "claim_bad.json");
    fs.writeFileSync(badPath, "{not valid json", "utf8");

    expect(listActiveClaims(backlogDir).map((candidate) => candidate.id)).toEqual([claim.id]);
    expect(fs.existsSync(badPath)).toBe(false);
    expect(fs.existsSync(path.join(backlogDir, "claims", "archive", "invalid", "claim_bad.json"))).toBe(true);
    expect(fs.existsSync(path.join(backlogDir, "claims", "archive", "invalid", "claim_bad.json.error.txt"))).toBe(true);
  });
});

function makeRepoWithContext(claimId: string): string {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-gc-repo-"));
  const gitDir = path.join(repoRoot, ".git");
  fs.mkdirSync(gitDir, { recursive: true });
  fs.writeFileSync(
    path.join(gitDir, "backlog-context.json"),
    JSON.stringify({ version: 1, claim_id: claimId, updated_at: new Date().toISOString() }, null, 2),
    "utf8",
  );
  return repoRoot;
}

describe("gcOrphanContextPointers", () => {
  it("removes pointers whose claim is no longer in active/, leaves live pointers alone", () => {
    const backlogDir = tmpBacklogDir();
    const liveClaim = createClaim({
      backlogDir,
      repo: "demo",
      repoPath: "/tmp/demo",
      topic: "live",
      paths: ["src/**"],
    });

    const liveRepo = makeRepoWithContext(liveClaim.id);
    const orphanRepoA = makeRepoWithContext("CLM-orphan-A-xxxx");
    const orphanRepoB = makeRepoWithContext("CLM-orphan-B-yyyy");
    const repoNoPointer = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-gc-bare-"));
    fs.mkdirSync(path.join(repoNoPointer, ".git"));

    const result = gcOrphanContextPointers({
      backlogDir,
      repoRoots: [liveRepo, orphanRepoA, orphanRepoB, repoNoPointer],
    });

    expect(result.scanned).toBe(3); // the bare repo has no pointer, so it isn't counted
    expect(result.removed.map((r) => r.claimId).sort()).toEqual([
      "CLM-orphan-A-xxxx",
      "CLM-orphan-B-yyyy",
    ]);

    expect(fs.existsSync(path.join(liveRepo, ".git", "backlog-context.json"))).toBe(true);
    expect(fs.existsSync(path.join(orphanRepoA, ".git", "backlog-context.json"))).toBe(false);
    expect(fs.existsSync(path.join(orphanRepoB, ".git", "backlog-context.json"))).toBe(false);
  });

  it("skips malformed pointers without crashing the sweep", () => {
    const backlogDir = tmpBacklogDir();
    const malformedRepo = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-gc-bad-"));
    fs.mkdirSync(path.join(malformedRepo, ".git"));
    fs.writeFileSync(path.join(malformedRepo, ".git", "backlog-context.json"), "{not valid json", "utf8");

    const orphanRepo = makeRepoWithContext("CLM-orphan-zzzz");

    const result = gcOrphanContextPointers({
      backlogDir,
      repoRoots: [malformedRepo, orphanRepo],
    });

    expect(result.removed.map((r) => r.claimId)).toEqual(["CLM-orphan-zzzz"]);
    expect(fs.existsSync(path.join(malformedRepo, ".git", "backlog-context.json"))).toBe(true);
  });

  it("returns empty when there are no pointers anywhere", () => {
    const backlogDir = tmpBacklogDir();
    const result = gcOrphanContextPointers({ backlogDir, repoRoots: [] });
    expect(result).toEqual({ scanned: 0, removed: [] });
  });
});
