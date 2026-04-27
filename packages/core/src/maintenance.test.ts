import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initLayout } from "@backlog/config";
import { garbageCollectExpiredClaims } from "@backlog/claims";
import { createClaim } from "@backlog/claims";
import { createRun, archiveRun, garbageCollectArchivedRuns, loadRun } from "./run-store.js";
import { createTask } from "./task-service.js";
import { createWorkItem } from "./work-service.js";
import { getAgent } from "./agents.js";

function createWorkspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-maint-"));
  initLayout({
    root,
    projectName: "maintenance-test",
    repos: [{ id: path.basename(root), path: root, default_branch: "main", enabled: true }],
  });
  return path.join(root, ".backlog");
}

describe("maintenance gc", () => {
  it("archives expired claims", () => {
    const backlogDir = createWorkspace();
    const repoId = path.basename(path.dirname(backlogDir));
    const claim = createClaim({
      backlogDir,
      repo: repoId,
      repoPath: path.dirname(backlogDir),
      topic: "expired",
      paths: ["README.md"],
      ttlMinutes: -1,
    });

    const result = garbageCollectExpiredClaims(backlogDir);
    expect(result.archived).toContain(claim.id);
    expect(fs.existsSync(path.join(backlogDir, "claims", "archive", `${claim.id}.json`))).toBe(true);
  });

  it("removes archived run directories", () => {
    const backlogDir = createWorkspace();
    const repoId = path.basename(path.dirname(backlogDir));
    const workItem = createWorkItem(backlogDir, { title: "gc run", repoTargets: [repoId] });
    const task = createTask(backlogDir, {
      workItemId: workItem.id,
      title: "gc task",
      repo: repoId,
    });
    const agent = getAgent(backlogDir, "manual-default");
    if (!agent) {
      throw new Error("Expected manual-default agent");
    }

    createRun({
      backlogDir,
      runId: "RUN-gc",
      task,
      workItem,
      agent,
      branch: "backlog/gc",
      worktreePath: path.dirname(backlogDir),
      claimIds: [],
    });
    archiveRun(backlogDir, "RUN-gc");

    expect(loadRun(backlogDir, "RUN-gc")?.id).toBe("RUN-gc");
    const result = garbageCollectArchivedRuns(backlogDir);
    expect(result.removed).toContain("RUN-gc");
    expect(loadRun(backlogDir, "RUN-gc")).toBeNull();
  });
});
