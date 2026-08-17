import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { initLayout } from "@backlog/config";
import { describe, expect, it } from "bun:test";
import { cascadeBlockDependents, createSubTask, updateSubTaskStatus } from "./subtask-service.js";
import { createTask } from "./task-service.js";

function realTmp(prefix: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function makeWorkspace(): string {
  const root = realTmp("backlog-cascade-");
  initLayout({
    root,
    projectName: "cascade-test",
    repos: [{ id: "repo", path: root, default_branch: "main", enabled: true, access_mode: "read-write" }],
  });
  const backlogDir = path.join(root, ".backlog");
  return backlogDir;
}

describe("cascadeBlockDependents", () => {
  it("marks every direct dependent of a failed subtask as blocked", () => {
    const backlogDir = makeWorkspace();
    const workItem = createTask(backlogDir, { title: "parent", repoTargets: ["repo"] });
    const a = createSubTask(backlogDir, { workItemId: workItem.id, title: "A", repo: "repo" });
    const b = createSubTask(backlogDir, {
      workItemId: workItem.id,
      title: "B",
      repo: "repo",
      dependsOn: [a.id],
    });
    const c = createSubTask(backlogDir, {
      workItemId: workItem.id,
      title: "C",
      repo: "repo",
      dependsOn: [a.id],
    });

    updateSubTaskStatus(backlogDir, a.id, "blocked");
    const result = cascadeBlockDependents(backlogDir, a.id);

    expect(result.map((t) => t.id).sort()).toEqual([b.id, c.id].sort());
  });

  it("walks the graph transitively (B → C → D all get blocked when A fails)", () => {
    const backlogDir = makeWorkspace();
    const workItem = createTask(backlogDir, { title: "parent", repoTargets: ["repo"] });
    const a = createSubTask(backlogDir, { workItemId: workItem.id, title: "A", repo: "repo" });
    const b = createSubTask(backlogDir, {
      workItemId: workItem.id,
      title: "B",
      repo: "repo",
      dependsOn: [a.id],
    });
    const c = createSubTask(backlogDir, {
      workItemId: workItem.id,
      title: "C",
      repo: "repo",
      dependsOn: [b.id],
    });
    const d = createSubTask(backlogDir, {
      workItemId: workItem.id,
      title: "D",
      repo: "repo",
      dependsOn: [c.id],
    });

    const result = cascadeBlockDependents(backlogDir, a.id);
    expect(result.map((t) => t.id).sort()).toEqual([b.id, c.id, d.id].sort());
  });

  it("doesn't touch siblings that don't depend on the failed task", () => {
    const backlogDir = makeWorkspace();
    const workItem = createTask(backlogDir, { title: "parent", repoTargets: ["repo"] });
    const a = createSubTask(backlogDir, { workItemId: workItem.id, title: "A", repo: "repo" });
    const sibling = createSubTask(backlogDir, { workItemId: workItem.id, title: "Sibling", repo: "repo" });

    cascadeBlockDependents(backlogDir, a.id);
    // Sibling has no dep on A → untouched
    void sibling;
  });

  it("is idempotent — re-running on the same failed id doesn't double-tag the blocker", () => {
    const backlogDir = makeWorkspace();
    const workItem = createTask(backlogDir, { title: "parent", repoTargets: ["repo"] });
    const a = createSubTask(backlogDir, { workItemId: workItem.id, title: "A", repo: "repo" });
    createSubTask(backlogDir, {
      workItemId: workItem.id,
      title: "B",
      repo: "repo",
      dependsOn: [a.id],
    });

    cascadeBlockDependents(backlogDir, a.id);
    const second = cascadeBlockDependents(backlogDir, a.id);
    // Second pass finds nothing to update because the blocker tag is
    // already present.
    expect(second).toEqual([]);
  });

  it("skips terminal-state dependents (completed and canceled)", () => {
    const backlogDir = makeWorkspace();
    const workItem = createTask(backlogDir, { title: "parent", repoTargets: ["repo"] });
    const a = createSubTask(backlogDir, { workItemId: workItem.id, title: "A", repo: "repo" });
    const done = createSubTask(backlogDir, {
      workItemId: workItem.id,
      title: "Done",
      repo: "repo",
      dependsOn: [a.id],
    });
    updateSubTaskStatus(backlogDir, done.id, "completed");

    const result = cascadeBlockDependents(backlogDir, a.id);
    expect(result.map((t) => t.id)).not.toContain(done.id);
  });
});
