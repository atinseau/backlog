import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initLayout } from "@cockpit-ai/config";
import { garbageCollectExpiredClaims } from "@cockpit-ai/claims";
import { createClaim } from "@cockpit-ai/claims";
import { createRun, archiveRun, garbageCollectArchivedRuns, loadRun } from "./run-store.js";
import { createTask } from "./task-service.js";
import { createWorkItem } from "./work-service.js";
import { getAgent } from "./agents.js";

function createWorkspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cockpit-maint-"));
  initLayout({
    root,
    workspaceName: "maintenance-test",
    repos: [{ id: path.basename(root), path: root, default_branch: "main", enabled: true }],
  });
  return path.join(root, ".cockpit");
}

describe("maintenance gc", () => {
  it("archives expired claims", () => {
    const cockpitDir = createWorkspace();
    const repoId = path.basename(path.dirname(cockpitDir));
    const claim = createClaim({
      cockpitDir,
      repo: repoId,
      repoPath: path.dirname(cockpitDir),
      topic: "expired",
      paths: ["README.md"],
      ttlMinutes: -1,
    });

    const result = garbageCollectExpiredClaims(cockpitDir);
    expect(result.archived).toContain(claim.id);
    expect(fs.existsSync(path.join(cockpitDir, "claims", "archive", `${claim.id}.json`))).toBe(true);
  });

  it("removes archived run directories", () => {
    const cockpitDir = createWorkspace();
    const repoId = path.basename(path.dirname(cockpitDir));
    const workItem = createWorkItem(cockpitDir, { title: "gc run", repoTargets: [repoId] });
    const task = createTask(cockpitDir, {
      workItemId: workItem.id,
      title: "gc task",
      repo: repoId,
    });
    const agent = getAgent(cockpitDir, "manual-default");
    if (!agent) {
      throw new Error("Expected manual-default agent");
    }

    createRun({
      cockpitDir,
      runId: "RUN-gc",
      task,
      workItem,
      agent,
      branch: "cockpit/gc",
      worktreePath: path.dirname(cockpitDir),
      claimIds: [],
    });
    archiveRun(cockpitDir, "RUN-gc");

    expect(loadRun(cockpitDir, "RUN-gc")?.id).toBe("RUN-gc");
    const result = garbageCollectArchivedRuns(cockpitDir);
    expect(result.removed).toContain("RUN-gc");
    expect(loadRun(cockpitDir, "RUN-gc")).toBeNull();
  });
});
