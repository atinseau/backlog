import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initLayout, loadConfig, saveConfig } from "@backlog/config";
import type { Agent } from "@backlog/schemas";
import { executeClaudeAgentRun } from "./claude-executor.js";
import { createRun, loadRun } from "./run-store.js";
import { createSubTask } from "./subtask-service.js";
import { createTask } from "./task-service.js";

function createWorkspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-claude-"));
  initLayout({
    root,
    projectName: "claude-test",
    repos: [{ id: path.basename(root), path: root, default_branch: "main", enabled: true }],
  });
  return root;
}

function writeFakeClaudeBinary(root: string): string {
  const fakeClaudePath = path.join(root, "fake-claude.sh");
  fs.writeFileSync(
    fakeClaudePath,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "echo 'Claude executor completed test run'",
    ].join("\n"),
    "utf8",
  );
  fs.chmodSync(fakeClaudePath, 0o755);
  return fakeClaudePath;
}

describe("executeClaudeAgentRun", () => {
  it("completes normal tasks even when the agent default is review", async () => {
    const root = createWorkspace();
    const backlogDir = path.join(root, ".backlog");
    const repoId = path.basename(root);
    const fakeClaudePath = writeFakeClaudeBinary(root);

    const workItem = createTask(backlogDir, { title: "Claude run", repoTargets: [repoId] });
    const task = createSubTask(backlogDir, {
      workItemId: workItem.id,
      title: "Implement with claude",
      repo: repoId,
      scopes: ["README.md"],
      risk: "low",
    });
    const agent: Agent = {
      id: "claude-test",
      provider: "claude",
      command: fakeClaudePath,
      enabled: true,
      max_concurrent_runs: 1,
      allowed_repos: [],
      allowed_risk: ["low", "medium"],
      capabilities: ["plan", "edit_code"],
      success_mode: "review",
      environment: {},
      retry_policy: { mode: "none", max_attempts: 1, reuse_worktree: true },
    };

    createRun({
      backlogDir,
      runId: "RUN-claude",
      task,
      workItem,
      agent,
      branch: "backlog/claude",
      worktreePath: root,
      claimIds: [],
    });

    await executeClaudeAgentRun({
      backlogDir,
      run: loadRun(backlogDir, "RUN-claude")!,
      task,
      workItem,
      agent,
    });

    const archivedRun = loadRun(backlogDir, "RUN-claude");
    expect(archivedRun?.status).toBe("succeeded");
    expect(archivedRun?.artifacts.some((artifact) => artifact.kind === "summary")).toBe(true);
    expect(archivedRun?.artifacts.some((artifact) => artifact.kind === "log")).toBe(true);
    expect(fs.existsSync(path.join(root, ".backlog-claude.log"))).toBe(true);
  });

  it("sends claude runs to review when the task requires manual approval", async () => {
    const root = createWorkspace();
    const backlogDir = path.join(root, ".backlog");
    const repoId = path.basename(root);
    const fakeClaudePath = writeFakeClaudeBinary(root);

    const workItem = createTask(backlogDir, { title: "Claude review run", repoTargets: [repoId] });
    const task = createSubTask(backlogDir, {
      workItemId: workItem.id,
      title: "Implement with review",
      repo: repoId,
      scopes: ["README.md"],
      risk: "low",
      manualApprovalRequired: true,
    });
    const agent: Agent = {
      id: "claude-test",
      provider: "claude",
      command: fakeClaudePath,
      enabled: true,
      max_concurrent_runs: 1,
      allowed_repos: [],
      allowed_risk: ["low", "medium"],
      capabilities: ["plan", "edit_code"],
      environment: {},
      retry_policy: { mode: "none", max_attempts: 1, reuse_worktree: true },
    };

    createRun({
      backlogDir,
      runId: "RUN-claude-review",
      task,
      workItem,
      agent,
      branch: "backlog/claude-review",
      worktreePath: root,
      claimIds: [],
    });

    await executeClaudeAgentRun({
      backlogDir,
      run: loadRun(backlogDir, "RUN-claude-review")!,
      task,
      workItem,
      agent,
    });

    expect(loadRun(backlogDir, "RUN-claude-review")?.status).toBe("awaiting_review");
  });

  it("sends successful runs to review when the project review column is enabled", async () => {
    const root = createWorkspace();
    const backlogDir = path.join(root, ".backlog");
    const repoId = path.basename(root);
    const fakeClaudePath = writeFakeClaudeBinary(root);
    const config = loadConfig(backlogDir);
    config.review.show_review_column = true;
    saveConfig(backlogDir, config);

    const workItem = createTask(backlogDir, { title: "Claude manual review project", repoTargets: [repoId] });
    const task = createSubTask(backlogDir, {
      workItemId: workItem.id,
      title: "Implement with project review",
      repo: repoId,
      scopes: ["README.md"],
      risk: "low",
    });
    const agent: Agent = {
      id: "claude-test",
      provider: "claude",
      command: fakeClaudePath,
      enabled: true,
      max_concurrent_runs: 1,
      allowed_repos: [],
      allowed_risk: ["low", "medium"],
      capabilities: ["plan", "edit_code"],
      environment: {},
      retry_policy: { mode: "none", max_attempts: 1, reuse_worktree: true },
    };

    createRun({
      backlogDir,
      runId: "RUN-claude-project-review",
      task,
      workItem,
      agent,
      branch: "backlog/claude-project-review",
      worktreePath: root,
      claimIds: [],
    });

    await executeClaudeAgentRun({
      backlogDir,
      run: loadRun(backlogDir, "RUN-claude-project-review")!,
      task,
      workItem,
      agent,
    });

    expect(loadRun(backlogDir, "RUN-claude-project-review")?.status).toBe("awaiting_review");
  });
});
