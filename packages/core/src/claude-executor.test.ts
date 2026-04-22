import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initLayout } from "@cockpit-ai/config";
import type { Agent } from "@cockpit-ai/schemas";
import { executeClaudeAgentRun } from "./claude-executor.js";
import { createRun, loadRun } from "./run-store.js";
import { createTask } from "./task-service.js";
import { createWorkItem } from "./work-service.js";

function createWorkspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cockpit-claude-"));
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
  it("runs claude print mode and archives the run on success", async () => {
    const root = createWorkspace();
    const cockpitDir = path.join(root, ".cockpit");
    const repoId = path.basename(root);
    const fakeClaudePath = writeFakeClaudeBinary(root);

    const workItem = createWorkItem(cockpitDir, { title: "Claude run", repoTargets: [repoId] });
    const task = createTask(cockpitDir, {
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
      cockpitDir,
      runId: "RUN-claude",
      task,
      workItem,
      agent,
      branch: "cockpit/claude",
      worktreePath: root,
      claimIds: [],
    });

    await executeClaudeAgentRun({
      cockpitDir,
      run: loadRun(cockpitDir, "RUN-claude")!,
      task,
      workItem,
      agent,
    });

    const archivedRun = loadRun(cockpitDir, "RUN-claude");
    expect(archivedRun?.status).toBe("succeeded");
    expect(archivedRun?.artifacts.some((artifact) => artifact.kind === "summary")).toBe(true);
    expect(fs.existsSync(path.join(root, ".cockpit-claude.log"))).toBe(true);
  });
});
