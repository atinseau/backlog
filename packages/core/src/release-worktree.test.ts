import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initLayout, loadConfig } from "@cockpit-ai/config";
import { git } from "@cockpit-ai/git";
import { getAgent } from "./agents.js";
import { archiveRun, createRun } from "./run-store.js";
import { createTask } from "./task-service.js";
import { createWorkItem } from "./work-service.js";
import { buildReleaseSnapshot } from "./release-snapshot.js";
import { garbageCollectWorktrees, listKnownWorktrees } from "./worktrees.js";

async function createWorkspace(): Promise<{ root: string; cockpitDir: string; repoId: string }> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cockpit-release-"));
  await git(["init", "-b", "main"], root);
  fs.writeFileSync(path.join(root, "README.md"), "# cockpit\n", "utf8");
  await git(["add", "README.md"], root);
  await git(["-c", "user.name=Cockpit", "-c", "user.email=cockpit@example.com", "commit", "-m", "init"], root);
  initLayout({
    root,
    workspaceName: "release-test",
    repos: [{ id: "release-test", path: root, default_branch: "main", enabled: true }],
  });
  return { root, cockpitDir: path.join(root, ".cockpit"), repoId: "release-test" };
}

describe("release and worktree operators", () => {
  it("captures dirty state and run counts in the release snapshot", async () => {
    const { root, cockpitDir, repoId } = await createWorkspace();
    const workItem = createWorkItem(cockpitDir, { title: "release snapshot", repoTargets: [repoId] });
    const task = createTask(cockpitDir, {
      workItemId: workItem.id,
      title: "task",
      repo: repoId,
    });
    const agent = getAgent(cockpitDir, "manual-default");
    if (!agent) {
      throw new Error("Expected manual-default agent");
    }

    createRun({
      cockpitDir,
      runId: "RUN-active",
      task,
      workItem,
      agent,
      branch: "cockpit/active",
      worktreePath: root,
      claimIds: [],
    });
    createRun({
      cockpitDir,
      runId: "RUN-archived",
      task,
      workItem,
      agent,
      branch: "cockpit/archived",
      worktreePath: root,
      claimIds: [],
    });
    archiveRun(cockpitDir, "RUN-archived");

    fs.writeFileSync(path.join(root, "DIRTY.txt"), "dirty\n", "utf8");

    const snapshot = await buildReleaseSnapshot(cockpitDir, loadConfig(cockpitDir));
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]).toMatchObject({
      repo: repoId,
      dirty: true,
      activeRuns: 1,
      archivedRuns: 1,
    });
  });

  it("lists known worktrees and supports dry-run garbage collection", async () => {
    const { cockpitDir, repoId } = await createWorkspace();
    const workItem = createWorkItem(cockpitDir, { title: "worktree snapshot", repoTargets: [repoId] });
    const task = createTask(cockpitDir, {
      workItemId: workItem.id,
      title: "task",
      repo: repoId,
    });
    const agent = getAgent(cockpitDir, "manual-default");
    if (!agent) {
      throw new Error("Expected manual-default agent");
    }

    const worktreePath = path.join(cockpitDir, "worktrees", repoId, "RUN-terminal");
    fs.mkdirSync(worktreePath, { recursive: true });

    createRun({
      cockpitDir,
      runId: "RUN-terminal",
      task,
      workItem,
      agent,
      branch: "cockpit/terminal",
      worktreePath,
      claimIds: [],
    });
    archiveRun(cockpitDir, "RUN-terminal");

    const worktrees = listKnownWorktrees(cockpitDir);
    expect(worktrees).toEqual([
      expect.objectContaining({
        runId: "RUN-terminal",
        repo: repoId,
        exists: true,
        active: false,
      }),
    ]);

    const dryRun = await garbageCollectWorktrees(cockpitDir, loadConfig(cockpitDir), { dryRun: true });
    expect(dryRun.removed).toContain(worktreePath);
    expect(fs.existsSync(worktreePath)).toBe(true);
  });
});
