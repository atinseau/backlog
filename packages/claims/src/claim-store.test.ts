import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createClaim, loadActiveClaim, loadActiveClaimIfPresent } from "./claim-store.js";

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

  it("loadActiveClaim still throws ENOENT on a missing claim — callers that want soft-fail should use loadActiveClaimIfPresent", () => {
    const backlogDir = tmpBacklogDir();
    expect(() => loadActiveClaim(backlogDir, "CLM-does-not-exist")).toThrowError(/ENOENT/);
  });
});
