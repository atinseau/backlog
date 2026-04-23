import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { initLayout } from "@cockpit-ai/config";
import { git } from "@cockpit-ai/git";
import { createTask } from "./task-service.js";
import { createWorkItem, updateWorkItemStatus } from "./work-service.js";
import { buildWorkspaceStatus } from "./status-builder.js";
import { createRun } from "./run-store.js";
import { getAgent } from "./agents.js";
import { createClaim } from "@cockpit-ai/claims";
import { loadConfig } from "@cockpit-ai/config";

async function createGitRepo(root: string, name: string): Promise<string> {
  const repoRoot = path.join(root, name);
  fs.mkdirSync(repoRoot, { recursive: true });
  await git(["init", "-b", "main"], repoRoot);
  fs.writeFileSync(path.join(repoRoot, "README.md"), `# ${name}\n`, "utf8");
  await git(["add", "README.md"], repoRoot);
  await git(["-c", "user.name=Cockpit", "-c", "user.email=cockpit@example.com", "commit", "-m", "init"], repoRoot);
  return repoRoot;
}

async function createWorkspace(): Promise<{ root: string; cockpitDir: string }> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cockpit-status-"));
  await git(["init", "-b", "main"], root);
  fs.writeFileSync(path.join(root, "README.md"), "# cockpit\n", "utf8");
  await git(["add", "README.md"], root);
  await git(["-c", "user.name=Cockpit", "-c", "user.email=cockpit@example.com", "commit", "-m", "init"], root);
  const docsRoot = await createGitRepo(root, "docs");
  initLayout({
    root,
    workspaceName: "status-test",
    mode: "embedded",
    repos: [
      { id: "cockpit", path: root, default_branch: "main", enabled: true },
      { id: "docs", path: docsRoot, default_branch: "main", enabled: false },
    ],
  });
  return { root, cockpitDir: path.join(root, ".cockpit") };
}

describe("buildWorkspaceStatus", () => {
  let root: string;
  let cockpitDir: string;

  beforeEach(async () => {
    ({ root, cockpitDir } = await createWorkspace());
  });

  it("builds repo summaries across the workspace", () => {
    const config = loadConfig(cockpitDir);
    const appItem = createWorkItem(cockpitDir, {
      title: "App task",
      repoTargets: ["cockpit"],
    });
    const docsItem = createWorkItem(cockpitDir, {
      title: "Docs task",
      repoTargets: ["docs"],
    });
    updateWorkItemStatus(cockpitDir, docsItem.id, "blocked");
    createTask(cockpitDir, {
      workItemId: appItem.id,
      title: "Ship app",
      repo: "cockpit",
    });
    const docsTask = createTask(cockpitDir, {
      workItemId: docsItem.id,
      title: "Write docs",
      repo: "docs",
    });
    const agent = getAgent(cockpitDir, "manual-default");
    if (!agent) {
      throw new Error("Expected manual-default agent");
    }
    createRun({
      cockpitDir,
      runId: "RUN-docs",
      task: docsTask,
      workItem: docsItem,
      agent,
      branch: "cockpit/docs",
      worktreePath: root,
      claimIds: [],
    });
    createClaim({
      cockpitDir,
      repo: "docs",
      repoPath: path.join(root, "docs"),
      topic: "docs scope",
      paths: ["README.md"],
    });

    const status = buildWorkspaceStatus(root, cockpitDir, config);
    expect(status.repoSummaries).toEqual([
      expect.objectContaining({
        id: "cockpit",
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
    const config = loadConfig(cockpitDir);
    const appItem = createWorkItem(cockpitDir, {
      title: "App task",
      repoTargets: ["cockpit"],
    });
    const docsItem = createWorkItem(cockpitDir, {
      title: "Docs task",
      repoTargets: ["docs"],
    });
    createTask(cockpitDir, {
      workItemId: appItem.id,
      title: "Ship app",
      repo: "cockpit",
    });
    createTask(cockpitDir, {
      workItemId: docsItem.id,
      title: "Write docs",
      repo: "docs",
    });

    const status = buildWorkspaceStatus(root, cockpitDir, config, { repoId: "docs" });
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
