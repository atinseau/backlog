import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";
import { writeContextFile } from "@backlog/claims";
import { initLayout, loadConfig } from "@backlog/config";
import { createClaim, listActiveClaims } from "@backlog/claims";
import { detectGitDir, git } from "@backlog/git";
import { createRun, getRunHandoffPath, loadRun } from "./run-store.js";
import { approveRun, completeRun, discardRun, requestRunChanges, sendRunToReview } from "./run-service.js";
import { createSubTask, getSubTask } from "./subtask-service.js";
import { createTask, getTask } from "./task-service.js";
import { getAgent } from "./agents.js";

async function createWorkspace(): Promise<string> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-run-"));
  await git(["init", "-b", "main"], root);
  await git(["config", "user.name", "Backlog"], root);
  await git(["config", "user.email", "backlog@example.com"], root);
  fs.writeFileSync(path.join(root, "README.md"), "smoke\n", "utf8");
  await git(["add", "README.md"], root);
  // Inline identity per call so the test doesn't depend on global git
  // config — CI runners ship without user.name/user.email set.
  await git(
    ["-c", "user.name=Backlog", "-c", "user.email=backlog@example.com", "commit", "-m", "init"],
    root,
  );

  initLayout({
    root,
    projectName: "test",
    repos: [{ id: path.basename(root), path: root, default_branch: "main", enabled: true }],
  });
  return root;
}

async function commitAll(cwd: string, message: string): Promise<void> {
  await git(["add", "-A"], cwd);
  await git(
    ["-c", "user.name=Backlog", "-c", "user.email=backlog@example.com", "commit", "-m", message],
    cwd,
  );
}

describe("completeRun", () => {
  it("archives active claims linked to the run", async () => {
    const root = await createWorkspace();
    const backlogDir = path.join(root, ".backlog");
    const config = loadConfig(backlogDir);
    const repoId = config.repos[0]!.id;

    const workItem = createTask(backlogDir, { title: "Finish a run", repoTargets: [repoId] });
    const task = createSubTask(backlogDir, {
      workItemId: workItem.id,
      title: "Run core work",
      repo: repoId,
      scopes: ["README.md"],
      risk: "low",
    });
    const claim = createClaim({
      backlogDir,
      repo: repoId,
      repoPath: root,
      topic: "run test",
      paths: ["README.md"],
    });
    const gitDir = await detectGitDir(root);
    writeContextFile(gitDir, {
      version: 1,
      claim_id: claim.id,
      updated_at: new Date().toISOString(),
    });

    const agent = getAgent(backlogDir, "claude-code");
    if (!agent) {
      throw new Error("Expected claude-code agent");
    }

    createRun({
      backlogDir,
      runId: "RUN-test",
      task,
      workItem,
      agent,
      branch: "backlog/test-run",
      worktreePath: root,
      claimIds: [claim.id],
    });

    await completeRun(backlogDir, "RUN-test", "done");

    expect(listActiveClaims(backlogDir)).toHaveLength(0);
    expect(fs.existsSync(path.join(backlogDir, "claims", "archive", `${claim.id}.json`))).toBe(true);
  });

  it("releases active claims when a run is sent to review", async () => {
    const root = await createWorkspace();
    const backlogDir = path.join(root, ".backlog");
    const config = loadConfig(backlogDir);
    const repoId = config.repos[0]!.id;

    const workItem = createTask(backlogDir, { title: "Review a run", repoTargets: [repoId] });
    const task = createSubTask(backlogDir, {
      workItemId: workItem.id,
      title: "Review task",
      repo: repoId,
      scopes: ["README.md"],
      risk: "low",
    });
    const claim = createClaim({
      backlogDir,
      repo: repoId,
      repoPath: root,
      topic: "review test",
      paths: ["README.md"],
    });
    const gitDir = await detectGitDir(root);
    writeContextFile(gitDir, {
      version: 1,
      claim_id: claim.id,
      updated_at: new Date().toISOString(),
    });

    const agent = getAgent(backlogDir, "claude-code");
    if (!agent) {
      throw new Error("Expected claude-code agent");
    }

    createRun({
      backlogDir,
      runId: "RUN-review",
      task,
      workItem,
      agent,
      branch: "backlog/test-review",
      worktreePath: root,
      claimIds: [claim.id],
    });

    await sendRunToReview(backlogDir, "RUN-review", "needs review");

    expect(listActiveClaims(backlogDir)).toHaveLength(0);
    expect(loadRun(backlogDir, "RUN-review")?.status).toBe("awaiting_review");
  });

  it("creates a handoff and re-plans the task when review requests changes", async () => {
    const root = await createWorkspace();
    const backlogDir = path.join(root, ".backlog");
    const config = loadConfig(backlogDir);
    const repoId = config.repos[0]!.id;

    const workItem = createTask(backlogDir, { title: "Need another pass", repoTargets: [repoId] });
    const task = createSubTask(backlogDir, {
      workItemId: workItem.id,
      title: "Retry task",
      repo: repoId,
      scopes: ["README.md"],
      risk: "low",
    });

    const agent = getAgent(backlogDir, "claude-code");
    if (!agent) {
      throw new Error("Expected claude-code agent");
    }

    createRun({
      backlogDir,
      runId: "RUN-changes",
      task,
      workItem,
      agent,
      branch: "backlog/test-request-changes",
      worktreePath: root,
      claimIds: [],
    });
    await sendRunToReview(backlogDir, "RUN-changes", "needs review");

    const handoffPath = await requestRunChanges(backlogDir, "RUN-changes", "Please tighten the scope and rerun tests");

    expect(loadRun(backlogDir, "RUN-changes")?.status).toBe("blocked");
    expect(getSubTask(backlogDir, task.id)?.status).toBe("planned");
    expect(getTask(backlogDir, workItem.id)?.status).toBe("in_progress");
    expect(getRunHandoffPath(backlogDir, "RUN-changes")).toBe(handoffPath);
    expect(fs.existsSync(handoffPath)).toBe(true);
    expect(fs.readFileSync(handoffPath, "utf8")).toContain("Please tighten the scope and rerun tests");
  });

  it("applies an approved review run to the main checkout before completing it", async () => {
    const root = await createWorkspace();
    const backlogDir = path.join(root, ".backlog");
    const config = loadConfig(backlogDir);
    const repoId = config.repos[0]!.id;
    const branch = "backlog/test-approve-merge";
    const worktreePath = path.join(backlogDir, "worktrees", repoId, "RUN-approve");
    await git(["worktree", "add", "-b", branch, worktreePath, "HEAD"], root);
    fs.writeFileSync(path.join(worktreePath, "applied.txt"), "merged\n", "utf8");
    fs.writeFileSync(path.join(worktreePath, ".backlog-claude.log"), "internal log\n", "utf8");
    await commitAll(worktreePath, "add applied file");

    const workItem = createTask(backlogDir, { title: "Approve applies work", repoTargets: [repoId] });
    const task = createSubTask(backlogDir, {
      workItemId: workItem.id,
      title: "Add applied file",
      repo: repoId,
      scopes: ["applied.txt"],
      risk: "low",
    });
    const agent = getAgent(backlogDir, "claude-code");
    if (!agent) throw new Error("Expected claude-code agent");
    createRun({
      backlogDir,
      runId: "RUN-approve",
      task,
      workItem,
      agent,
      branch,
      worktreePath,
      claimIds: [],
    });
    await sendRunToReview(backlogDir, "RUN-approve", "ready");

    await approveRun(backlogDir, "RUN-approve", "approved", { mergeStrategy: "fast_forward" });

    expect(fs.readFileSync(path.join(root, "applied.txt"), "utf8")).toBe("merged\n");
    expect(fs.existsSync(path.join(root, ".backlog-claude.log"))).toBe(false);
    expect(loadRun(backlogDir, "RUN-approve")?.status).toBe("succeeded");
    expect(getSubTask(backlogDir, task.id)?.status).toBe("completed");
    expect(getTask(backlogDir, workItem.id)?.status).toBe("done");
    expect(fs.existsSync(worktreePath)).toBe(false);
  });

  it("applies a diverged review run with a merge commit", async () => {
    const root = await createWorkspace();
    const backlogDir = path.join(root, ".backlog");
    const config = loadConfig(backlogDir);
    const repoId = config.repos[0]!.id;
    const firstBranch = "backlog/test-first-merge";
    const secondBranch = "backlog/test-second-merge";
    const firstWorktree = path.join(backlogDir, "worktrees", repoId, "RUN-first");
    const secondWorktree = path.join(backlogDir, "worktrees", repoId, "RUN-second");
    await git(["worktree", "add", "-b", firstBranch, firstWorktree, "HEAD"], root);
    await git(["worktree", "add", "-b", secondBranch, secondWorktree, "HEAD"], root);
    fs.writeFileSync(path.join(firstWorktree, "first.txt"), "first\n", "utf8");
    fs.writeFileSync(path.join(secondWorktree, "second.txt"), "second\n", "utf8");
    await commitAll(firstWorktree, "add first file");
    await commitAll(secondWorktree, "add second file");

    const firstTaskCard = createTask(backlogDir, { title: "First apply", repoTargets: [repoId] });
    const firstTask = createSubTask(backlogDir, {
      workItemId: firstTaskCard.id,
      title: "Add first file",
      repo: repoId,
      scopes: ["first.txt"],
      risk: "low",
    });
    const secondTaskCard = createTask(backlogDir, { title: "Second apply", repoTargets: [repoId] });
    const secondTask = createSubTask(backlogDir, {
      workItemId: secondTaskCard.id,
      title: "Add second file",
      repo: repoId,
      scopes: ["second.txt"],
      risk: "low",
    });
    const agent = getAgent(backlogDir, "claude-code");
    if (!agent) throw new Error("Expected claude-code agent");
    createRun({
      backlogDir,
      runId: "RUN-first",
      task: firstTask,
      workItem: firstTaskCard,
      agent,
      branch: firstBranch,
      worktreePath: firstWorktree,
      claimIds: [],
    });
    createRun({
      backlogDir,
      runId: "RUN-second",
      task: secondTask,
      workItem: secondTaskCard,
      agent,
      branch: secondBranch,
      worktreePath: secondWorktree,
      claimIds: [],
    });
    await sendRunToReview(backlogDir, "RUN-first", "ready");
    await sendRunToReview(backlogDir, "RUN-second", "ready");

    await approveRun(backlogDir, "RUN-first", "approved", { mergeStrategy: "fast_forward" });
    await approveRun(backlogDir, "RUN-second", "approved", { mergeStrategy: "merge_commit" });

    expect(fs.readFileSync(path.join(root, "first.txt"), "utf8")).toBe("first\n");
    expect(fs.readFileSync(path.join(root, "second.txt"), "utf8")).toBe("second\n");
    const parents = (await git(["rev-list", "--parents", "-n", "1", "HEAD"], root)).trim().split(/\s+/);
    expect(parents).toHaveLength(3);
    expect(loadRun(backlogDir, "RUN-second")?.status).toBe("succeeded");
    expect(getSubTask(backlogDir, secondTask.id)?.status).toBe("completed");
    expect(getTask(backlogDir, secondTaskCard.id)?.status).toBe("done");
  });

  it("keeps a review run open when apply cannot merge", async () => {
    const root = await createWorkspace();
    const backlogDir = path.join(root, ".backlog");
    const config = loadConfig(backlogDir);
    const repoId = config.repos[0]!.id;
    const branch = "backlog/test-approve-dirty";
    const worktreePath = path.join(backlogDir, "worktrees", repoId, "RUN-dirty");
    await git(["worktree", "add", "-b", branch, worktreePath, "HEAD"], root);
    fs.writeFileSync(path.join(worktreePath, "dirty-apply.txt"), "from run\n", "utf8");
    await commitAll(worktreePath, "add dirty apply file");

    const workItem = createTask(backlogDir, { title: "Dirty checkout blocks apply", repoTargets: [repoId] });
    const task = createSubTask(backlogDir, {
      workItemId: workItem.id,
      title: "Add dirty apply file",
      repo: repoId,
      scopes: ["dirty-apply.txt"],
      risk: "low",
    });
    const agent = getAgent(backlogDir, "claude-code");
    if (!agent) throw new Error("Expected claude-code agent");
    createRun({
      backlogDir,
      runId: "RUN-dirty",
      task,
      workItem,
      agent,
      branch,
      worktreePath,
      claimIds: [],
    });
    await sendRunToReview(backlogDir, "RUN-dirty", "ready");
    fs.appendFileSync(path.join(root, "README.md"), "uncommitted\n", "utf8");

    await expect(approveRun(backlogDir, "RUN-dirty", "approved", { mergeStrategy: "fast_forward" }))
      .rejects.toThrow(/has uncommitted changes/);

    expect(loadRun(backlogDir, "RUN-dirty")?.status).toBe("awaiting_review");
    expect(getSubTask(backlogDir, task.id)?.status).toBe("review");
    expect(getTask(backlogDir, workItem.id)?.status).toBe("review");
    expect(fs.existsSync(path.join(root, "dirty-apply.txt"))).toBe(false);
    expect(fs.existsSync(worktreePath)).toBe(true);
  });

  it("discards a reviewed run by removing its worktree and branch", async () => {
    const root = await createWorkspace();
    const backlogDir = path.join(root, ".backlog");
    const config = loadConfig(backlogDir);
    const repoId = config.repos[0]!.id;
    const branch = "backlog/test-discard";
    const worktreePath = path.join(backlogDir, "worktrees", repoId, "RUN-discard");
    await git(["worktree", "add", "-b", branch, worktreePath, "HEAD"], root);
    fs.writeFileSync(path.join(worktreePath, "discard.txt"), "discard me\n", "utf8");
    await commitAll(worktreePath, "add discard file");

    const workItem = createTask(backlogDir, { title: "Discard worktree run", repoTargets: [repoId] });
    const task = createSubTask(backlogDir, {
      workItemId: workItem.id,
      title: "Add discard file",
      repo: repoId,
      scopes: ["discard.txt"],
      risk: "low",
    });
    const agent = getAgent(backlogDir, "claude-code");
    if (!agent) throw new Error("Expected claude-code agent");
    createRun({
      backlogDir,
      runId: "RUN-discard",
      task,
      workItem,
      agent,
      branch,
      worktreePath,
      claimIds: [],
    });
    await sendRunToReview(backlogDir, "RUN-discard", "ready");

    await discardRun(backlogDir, "RUN-discard", "discarded");

    expect(fs.existsSync(worktreePath)).toBe(false);
    expect(fs.existsSync(path.join(root, "discard.txt"))).toBe(false);
    expect(loadRun(backlogDir, "RUN-discard")?.status).toBe("canceled");
    expect(getSubTask(backlogDir, task.id)?.status).toBe("planned");
    expect(getTask(backlogDir, workItem.id)?.status).toBe("ready");
  });
});
