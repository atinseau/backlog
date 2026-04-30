import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { writeContextFile } from "@backlog/claims";
import { initLayout, loadConfig } from "@backlog/config";
import { createClaim, listActiveClaims } from "@backlog/claims";
import { detectGitDir, git } from "@backlog/git";
import { createRun, getRunHandoffPath, loadRun } from "./run-store.js";
import { approveRun, completeRun, requestRunChanges, sendRunToReview } from "./run-service.js";
import { createSubTask, getSubTask } from "./subtask-service.js";
import { createTask, getTask } from "./task-service.js";
import { getAgent } from "./agents.js";

async function createWorkspace(): Promise<string> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-run-"));
  await git(["init", "-b", "main"], root);
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
});
