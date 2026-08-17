import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";
import { initLayout } from "@backlog/config";
import type { Agent } from "@backlog/schemas";
import { executeCodexAgentRun } from "./codex-executor.js";
import { createRun, loadRun } from "./run-store.js";
import { createSubTask } from "./subtask-service.js";
import { createTask } from "./task-service.js";

function createWorkspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-codex-"));
  initLayout({
    root,
    projectName: "codex-test",
    repos: [{ id: path.basename(root), path: root, default_branch: "main", enabled: true }],
  });
  return root;
}

function writeFakeCodexBinary(root: string): string {
  const fakeCodexPath = path.join(root, "fake-codex.sh");
  fs.writeFileSync(
    fakeCodexPath,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "out=\"\"",
      "while [[ $# -gt 0 ]]; do",
      "  if [[ \"$1\" == \"--output-last-message\" ]]; then",
      "    out=\"$2\"",
      "    shift 2",
      "    continue",
      "  fi",
      "  shift",
      "done",
      "cat >/dev/null",
      "printf 'Codex executor completed test run\\n' > \"$out\"",
    ].join("\n"),
    "utf8",
  );
  fs.chmodSync(fakeCodexPath, 0o755);
  return fakeCodexPath;
}

describe("executeCodexAgentRun", () => {
  it("runs codex exec and completes by default", async () => {
    const root = createWorkspace();
    const backlogDir = path.join(root, ".backlog");
    const repoId = path.basename(root);
    const fakeCodexPath = writeFakeCodexBinary(root);

    const workItem = createTask(backlogDir, { title: "Codex run", repoTargets: [repoId] });
    const task = createSubTask(backlogDir, {
      workItemId: workItem.id,
      title: "Implement with codex",
      repo: repoId,
      scopes: ["README.md"],
      risk: "low",
    });
    const agent: Agent = {
      id: "codex-test",
      provider: "codex",
      command: fakeCodexPath,
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
      runId: "RUN-codex",
      task,
      workItem,
      agent,
      branch: "backlog/codex",
      worktreePath: root,
      claimIds: [],
    });

    await executeCodexAgentRun({
      backlogDir,
      run: loadRun(backlogDir, "RUN-codex")!,
      task,
      workItem,
      agent,
    });

    const archivedRun = loadRun(backlogDir, "RUN-codex");
    expect(archivedRun?.status).toBe("succeeded");
    expect(archivedRun?.artifacts.some((artifact) => artifact.kind === "summary")).toBe(true);
    expect(archivedRun?.artifacts.some((artifact) => artifact.kind === "log")).toBe(true);
    expect(fs.existsSync(path.join(root, ".backlog-codex.log"))).toBe(true);
  });
});
