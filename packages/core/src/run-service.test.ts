import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { writeContextFile } from "@backlog/claims";
import { initLayout, loadConfig } from "@backlog/config";
import { createClaim, listActiveClaims } from "@backlog/claims";
import { detectGitDir, git } from "@backlog/git";
import { createRun, getRunHandoffPath, loadRun } from "./run-store.js";
import { completeRun, requestRunChanges, sendRunToReview } from "./run-service.js";
import { createSubTask, getSubTask } from "./subtask-service.js";
import { createTask, getTask } from "./task-service.js";
import { getAgent } from "./agents.js";

async function createWorkspace(): Promise<string> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-run-"));
  await git(["init"], root);
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

    const agent = getAgent(backlogDir, "manual-default");
    if (!agent) {
      throw new Error("Expected manual-default agent");
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

    const agent = getAgent(backlogDir, "manual-default");
    if (!agent) {
      throw new Error("Expected manual-default agent");
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

    const agent = getAgent(backlogDir, "manual-default");
    if (!agent) {
      throw new Error("Expected manual-default agent");
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
});
