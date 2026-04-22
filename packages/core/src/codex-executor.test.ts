import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initLayout } from "@cockpit-ai/config";
import type { Agent } from "@cockpit-ai/schemas";
import { executeCodexAgentRun } from "./codex-executor.js";
import { createRun, loadRun } from "./run-store.js";
import { createTask } from "./task-service.js";
import { createWorkItem } from "./work-service.js";

function createWorkspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cockpit-codex-"));
  initLayout({
    root,
    workspaceName: "codex-test",
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
  it("runs codex exec and archives the run on success", async () => {
    const root = createWorkspace();
    const cockpitDir = path.join(root, ".cockpit");
    const repoId = path.basename(root);
    const fakeCodexPath = writeFakeCodexBinary(root);

    const workItem = createWorkItem(cockpitDir, { title: "Codex run", repoTargets: [repoId] });
    const task = createTask(cockpitDir, {
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
    };

    createRun({
      cockpitDir,
      runId: "RUN-codex",
      task,
      workItem,
      agent,
      branch: "cockpit/codex",
      worktreePath: root,
      claimIds: [],
    });

    await executeCodexAgentRun({
      cockpitDir,
      run: loadRun(cockpitDir, "RUN-codex")!,
      task,
      workItem,
      agent,
    });

    const archivedRun = loadRun(cockpitDir, "RUN-codex");
    expect(archivedRun?.status).toBe("succeeded");
    expect(archivedRun?.artifacts.some((artifact) => artifact.kind === "summary")).toBe(true);
    expect(fs.existsSync(path.join(root, ".cockpit-codex.log"))).toBe(true);
  });
});
