import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initLayout } from "@backlog/config";
import type { Agent } from "@backlog/schemas";
import { executeClaudeAgentRun } from "./claude-executor.js";
import { createRun, loadRun } from "./run-store.js";
import { createTask } from "./task-service.js";
import { createWorkItem } from "./work-service.js";

function createWorkspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-claude-"));
  initLayout({
    root,
    workspaceName: "claude-test",
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
  it("runs claude print mode and sends the run to review by default", async () => {
    const root = createWorkspace();
    const backlogDir = path.join(root, ".backlog");
    const repoId = path.basename(root);
    const fakeClaudePath = writeFakeClaudeBinary(root);

    const workItem = createWorkItem(backlogDir, { title: "Claude run", repoTargets: [repoId] });
    const task = createTask(backlogDir, {
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
      environment: {},
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
    expect(archivedRun?.status).toBe("awaiting_review");
    expect(archivedRun?.artifacts.some((artifact) => artifact.kind === "summary")).toBe(true);
    expect(archivedRun?.artifacts.some((artifact) => artifact.kind === "log")).toBe(true);
    expect(fs.existsSync(path.join(root, ".backlog-claude.log"))).toBe(true);
  });
});
