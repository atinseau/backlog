import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { initLayout } from "@backlog/config";
import { git } from "@backlog/git";
import { createSubTask } from "./subtask-service.js";
import { createTask, updateTaskStatus } from "./task-service.js";
import { buildWorkspaceStatus } from "./status-builder.js";
import { createRun } from "./run-store.js";
import { getAgent } from "./agents.js";
import { createClaim } from "@backlog/claims";
import { loadConfig } from "@backlog/config";

async function createGitRepo(root: string, name: string): Promise<string> {
  const repoRoot = path.join(root, name);
  fs.mkdirSync(repoRoot, { recursive: true });
  await git(["init", "-b", "main"], repoRoot);
  fs.writeFileSync(path.join(repoRoot, "README.md"), `# ${name}\n`, "utf8");
  await git(["add", "README.md"], repoRoot);
  await git(["-c", "user.name=Backlog", "-c", "user.email=backlog@example.com", "commit", "-m", "init"], repoRoot);
  return repoRoot;
}

async function createWorkspace(): Promise<{ root: string; backlogDir: string }> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-status-"));
  await git(["init", "-b", "main"], root);
  fs.writeFileSync(path.join(root, "README.md"), "# backlog\n", "utf8");
  await git(["add", "README.md"], root);
  await git(["-c", "user.name=Backlog", "-c", "user.email=backlog@example.com", "commit", "-m", "init"], root);
  const docsRoot = await createGitRepo(root, "docs");
  initLayout({
    root,
    projectName: "status-test",
    mode: "embedded",
    repos: [
      { id: "backlog", path: root, default_branch: "main", enabled: true, access_mode: "read-write" },
      { id: "docs", path: docsRoot, default_branch: "main", enabled: false, access_mode: "read-write" },
    ],
  });
  return { root, backlogDir: path.join(root, ".backlog") };
}

describe("buildWorkspaceStatus", () => {
  let root: string;
  let backlogDir: string;

  beforeEach(async () => {
    ({ root, backlogDir } = await createWorkspace());
  });

  it("builds repo summaries across the workspace", () => {
    const config = loadConfig(backlogDir);
    const appItem = createTask(backlogDir, {
      title: "App task",
      repoTargets: ["backlog"],
    });
    const docsItem = createTask(backlogDir, {
      title: "Docs task",
      repoTargets: ["docs"],
    });
    updateTaskStatus(backlogDir, docsItem.id, "blocked");
    createSubTask(backlogDir, {
      workItemId: appItem.id,
      title: "Ship app",
      repo: "backlog",
    });
    const docsTask = createSubTask(backlogDir, {
      workItemId: docsItem.id,
      title: "Write docs",
      repo: "docs",
    });
    const agent = getAgent(backlogDir, "claude-code");
    if (!agent) {
      throw new Error("Expected claude-code agent");
    }
    createRun({
      backlogDir,
      runId: "RUN-docs",
      task: docsTask,
      workItem: docsItem,
      agent,
      branch: "backlog/docs",
      worktreePath: root,
      claimIds: [],
    });
    createClaim({
      backlogDir,
      repo: "docs",
      repoPath: path.join(root, "docs"),
      topic: "docs scope",
      paths: ["README.md"],
    });

    const status = buildWorkspaceStatus(root, backlogDir, config);
    expect(status.repoSummaries).toEqual([
      expect.objectContaining({
        id: "backlog",
        enabled: true,
        workItemCount: 1,
        taskCount: 1,
        activeRuns: 0,
        activeClaims: 0,
      }),
      expect.objectContaining({
        id: "docs",
        enabled: false,
        workItemCount: 1,
        taskCount: 1,
        activeRuns: 1,
        activeClaims: 1,
      }),
    ]);
  });

  it("can focus status on one repo", () => {
    const config = loadConfig(backlogDir);
    const appItem = createTask(backlogDir, {
      title: "App task",
      repoTargets: ["backlog"],
    });
    const docsItem = createTask(backlogDir, {
      title: "Docs task",
      repoTargets: ["docs"],
    });
    createSubTask(backlogDir, {
      workItemId: appItem.id,
      title: "Ship app",
      repo: "backlog",
    });
    createSubTask(backlogDir, {
      workItemId: docsItem.id,
      title: "Write docs",
      repo: "docs",
    });

    const status = buildWorkspaceStatus(root, backlogDir, config, { repoId: "docs" });
    expect(status.selectedRepoId).toBe("docs");
    expect(status.workItemCount).toBe(1);
    expect(status.repoSummaries).toHaveLength(1);
    expect(status.repoSummaries[0]).toMatchObject({
      id: "docs",
      taskCount: 1,
      workItemCount: 1,
    });
  });
});
