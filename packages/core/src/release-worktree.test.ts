import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initLayout, loadConfig, saveConfig } from "@backlog/config";
import { git } from "@backlog/git";
import { getAgent } from "./agents.js";
import { archiveRun, createRun } from "./run-store.js";
import { createSubTask } from "./subtask-service.js";
import { createWorkItem } from "./work-service.js";
import { buildReleaseSnapshot } from "./release-snapshot.js";
import { garbageCollectWorktrees, listKnownWorktrees } from "./worktrees.js";

async function createWorkspace(): Promise<{ root: string; backlogDir: string; repoId: string }> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-release-"));
  await git(["init", "-b", "main"], root);
  fs.writeFileSync(path.join(root, "README.md"), "# backlog\n", "utf8");
  await git(["add", "README.md"], root);
  await git(["-c", "user.name=Backlog", "-c", "user.email=backlog@example.com", "commit", "-m", "init"], root);
  initLayout({
    root,
    projectName: "release-test",
    repos: [{ id: "release-test", path: root, default_branch: "main", enabled: true }],
  });
  return { root, backlogDir: path.join(root, ".backlog"), repoId: "release-test" };
}

describe("release and worktree operators", () => {
  it("captures dirty state and run counts in the release snapshot", async () => {
    const { root, backlogDir, repoId } = await createWorkspace();
    const workItem = createWorkItem(backlogDir, { title: "release snapshot", repoTargets: [repoId] });
    const task = createSubTask(backlogDir, {
      workItemId: workItem.id,
      title: "task",
      repo: repoId,
    });
    const agent = getAgent(backlogDir, "manual-default");
    if (!agent) {
      throw new Error("Expected manual-default agent");
    }

    createRun({
      backlogDir,
      runId: "RUN-active",
      task,
      workItem,
      agent,
      branch: "backlog/active",
      worktreePath: root,
      claimIds: [],
    });
    createRun({
      backlogDir,
      runId: "RUN-archived",
      task,
      workItem,
      agent,
      branch: "backlog/archived",
      worktreePath: root,
      claimIds: [],
    });
    archiveRun(backlogDir, "RUN-archived");

    fs.writeFileSync(path.join(root, "DIRTY.txt"), "dirty\n", "utf8");

    const snapshot = await buildReleaseSnapshot(backlogDir, loadConfig(backlogDir));
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]).toMatchObject({
      repo: repoId,
      enabled: true,
      dirty: true,
      activeRuns: 1,
      archivedRuns: 1,
    });
  });

  it("can include disabled repos and target one repo explicitly", async () => {
    const { root, backlogDir } = await createWorkspace();
    const docsRoot = path.join(root, "docs");
    fs.mkdirSync(docsRoot, { recursive: true });
    await git(["init", "-b", "trunk"], docsRoot);
    fs.writeFileSync(path.join(docsRoot, "README.md"), "# docs\n", "utf8");
    await git(["add", "README.md"], docsRoot);
    await git(["-c", "user.name=Backlog", "-c", "user.email=backlog@example.com", "commit", "-m", "init"], docsRoot);

    const config = loadConfig(backlogDir);
    config.repos.push({
      id: "docs",
      path: docsRoot,
      default_branch: "trunk",
      enabled: false,
    });
    saveConfig(backlogDir, config);

    const enabledOnly = await buildReleaseSnapshot(backlogDir, loadConfig(backlogDir));
    expect(enabledOnly.map((repo) => repo.repo)).toEqual(["release-test"]);

    const includingDisabled = await buildReleaseSnapshot(backlogDir, loadConfig(backlogDir), {
      includeDisabled: true,
    });
    expect(includingDisabled.map((repo) => repo.repo)).toEqual(["release-test", "docs"]);
    expect(includingDisabled.find((repo) => repo.repo === "docs")).toMatchObject({
      enabled: false,
      branch: "trunk",
    });

    const targeted = await buildReleaseSnapshot(backlogDir, loadConfig(backlogDir), {
      repoId: "docs",
      includeDisabled: true,
    });
    expect(targeted).toHaveLength(1);
    expect(targeted[0]?.repo).toBe("docs");
  });

  it("lists known worktrees and supports dry-run garbage collection", async () => {
    const { backlogDir, repoId } = await createWorkspace();
    const workItem = createWorkItem(backlogDir, { title: "worktree snapshot", repoTargets: [repoId] });
    const task = createSubTask(backlogDir, {
      workItemId: workItem.id,
      title: "task",
      repo: repoId,
    });
    const agent = getAgent(backlogDir, "manual-default");
    if (!agent) {
      throw new Error("Expected manual-default agent");
    }

    const worktreePath = path.join(backlogDir, "worktrees", repoId, "RUN-terminal");
    fs.mkdirSync(worktreePath, { recursive: true });

    createRun({
      backlogDir,
      runId: "RUN-terminal",
      task,
      workItem,
      agent,
      branch: "backlog/terminal",
      worktreePath,
      claimIds: [],
    });
    archiveRun(backlogDir, "RUN-terminal");

    const worktrees = listKnownWorktrees(backlogDir);
    expect(worktrees).toEqual([
      expect.objectContaining({
        runId: "RUN-terminal",
        repo: repoId,
        exists: true,
        active: false,
      }),
    ]);

    const dryRun = await garbageCollectWorktrees(backlogDir, loadConfig(backlogDir), { dryRun: true });
    expect(dryRun.removed).toContain(worktreePath);
    expect(fs.existsSync(worktreePath)).toBe(true);
  });
});
