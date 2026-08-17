import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";
import { initLayout, loadConfig, saveConfig } from "@backlog/config";
import { git } from "@backlog/git";
import { getAgent } from "./agents.js";
import { archiveRun, createRun } from "./run-store.js";
import { createSubTask } from "./subtask-service.js";
import { createTask } from "./task-service.js";
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
    const workItem = createTask(backlogDir, { title: "release snapshot", repoTargets: [repoId] });
    const task = createSubTask(backlogDir, {
      workItemId: workItem.id,
      title: "task",
      repo: repoId,
    });
    const agent = getAgent(backlogDir, "claude-code");
    if (!agent) {
      throw new Error("Expected claude-code agent");
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
    const { root, backlogDir, repoId } = await createWorkspace();
    const workItem = createTask(backlogDir, { title: "worktree snapshot", repoTargets: [repoId] });
    const task = createSubTask(backlogDir, {
      workItemId: workItem.id,
      title: "task",
      repo: repoId,
    });
    const agent = getAgent(backlogDir, "claude-code");
    if (!agent) {
      throw new Error("Expected claude-code agent");
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

    // Legacy shape: an archived run whose worktree_path is the repository's
    // own checkout, exactly what every run created under the removed
    // "direct" execution mode looks like on disk. Nothing migrates
    // archived run.json records (schemas/src/run.ts's non-strict parsing
    // just strips the old execution_mode field on read), so records like
    // this exist in real installs today. GC must recognize it by path and
    // leave it alone rather than trying (and failing) to `git worktree
    // remove` the main working tree.
    createRun({
      backlogDir,
      runId: "RUN-direct",
      task,
      workItem,
      agent,
      branch: "main",
      worktreePath: root,
      claimIds: [],
    });
    archiveRun(backlogDir, "RUN-direct");

    // The legacy record is left out entirely: `worktree list` answers "which
    // worktrees does Backlog own", and presenting the user's own checkout as
    // one of them invites the removal that GC refuses two lines below.
    const worktrees = listKnownWorktrees(backlogDir, loadConfig(backlogDir));
    expect(worktrees).toEqual([
      expect.objectContaining({
        runId: "RUN-terminal",
        repo: repoId,
        exists: true,
        active: false,
      }),
    ]);
    expect(worktrees.map((entry) => entry.path)).not.toContain(root);

    const dryRun = await garbageCollectWorktrees(backlogDir, loadConfig(backlogDir), { dryRun: true });
    expect(dryRun.removed).toContain(worktreePath);
    expect(dryRun.removed).not.toContain(root);
    expect(fs.existsSync(worktreePath)).toBe(true);
    expect(fs.existsSync(root)).toBe(true);
  });

  it("skips a legacy archived run whose worktree_path is the repository's own checkout, without crashing", async () => {
    const { root, backlogDir, repoId } = await createWorkspace();
    const workItem = createTask(backlogDir, { title: "legacy direct run", repoTargets: [repoId] });
    const task = createSubTask(backlogDir, {
      workItemId: workItem.id,
      title: "task",
      repo: repoId,
    });
    const agent = getAgent(backlogDir, "claude-code");
    if (!agent) {
      throw new Error("Expected claude-code agent");
    }

    // Same legacy shape as above, but this time exercised through a real
    // (non-dry-run) GC pass — the path where `git worktree remove --force
    // <mainCheckout>` used to throw ("is a main working tree") and, since
    // the archived-runs loop has no try/catch, abort GC for every run
    // queued after it.
    createRun({
      backlogDir,
      runId: "RUN-direct",
      task,
      workItem,
      agent,
      branch: "main",
      worktreePath: root,
      claimIds: [],
    });
    archiveRun(backlogDir, "RUN-direct");

    const result = await garbageCollectWorktrees(backlogDir, loadConfig(backlogDir));
    expect(result.removed).not.toContain(root);
    expect(fs.existsSync(root)).toBe(true);
  });

  it("keeps cleaning after a record git refuses to remove", async () => {
    // The path guard keys on the checkout path *as configured today*. Move the
    // repository in config.toml and a legacy record stops matching it, so
    // `git worktree remove --force` runs against something that is not a
    // worktree and throws — which used to leave every archived run behind it
    // uncleaned, the exact failure the guard was written to prevent.
    const { root, backlogDir, repoId } = await createWorkspace();
    const workItem = createTask(backlogDir, { title: "moved repository", repoTargets: [repoId] });
    const task = createSubTask(backlogDir, { workItemId: workItem.id, title: "task", repo: repoId });
    const agent = getAgent(backlogDir, "claude-code");
    if (!agent) {
      throw new Error("Expected claude-code agent");
    }

    const stalePath = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-moved-checkout-"));
    const worktreePath = path.join(backlogDir, "worktrees", repoId, "RUN-after");
    await git(["worktree", "add", "-b", "backlog/after", worktreePath], root);

    for (const [runId, worktree] of [["RUN-unremovable", stalePath], ["RUN-after", worktreePath]] as const) {
      createRun({
        backlogDir,
        runId,
        task,
        workItem,
        agent,
        branch: "main",
        worktreePath: worktree,
        claimIds: [],
      });
      archiveRun(backlogDir, runId);
    }

    const result = await garbageCollectWorktrees(backlogDir, loadConfig(backlogDir));

    expect(result.skipped).toContain(stalePath);
    expect(result.removed).toContain(worktreePath);
    expect(fs.existsSync(stalePath)).toBe(true);
  });
});
