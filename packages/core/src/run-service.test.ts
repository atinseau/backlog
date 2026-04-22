import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { writeContextFile } from "@cockpit-ai/claims";
import { initLayout, loadConfig } from "@cockpit-ai/config";
import { createClaim, listActiveClaims } from "@cockpit-ai/claims";
import { detectGitDir, git } from "@cockpit-ai/git";
import { createRun, loadRun } from "./run-store.js";
import { completeRun, sendRunToReview } from "./run-service.js";
import { createTask } from "./task-service.js";
import { createWorkItem } from "./work-service.js";
import { getAgent } from "./agents.js";

async function createWorkspace(): Promise<string> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cockpit-run-"));
  await git(["init"], root);
  fs.writeFileSync(path.join(root, "README.md"), "smoke\n", "utf8");
  await git(["add", "README.md"], root);
  await git(["commit", "-m", "init"], root);

  initLayout({
    root,
    workspaceName: "test",
    repos: [{ id: path.basename(root), path: root, default_branch: "main", enabled: true }],
  });
  return root;
}

describe("completeRun", () => {
  it("archives active claims linked to the run", async () => {
    const root = await createWorkspace();
    const cockpitDir = path.join(root, ".cockpit");
    const config = loadConfig(cockpitDir);
    const repoId = config.repos[0]!.id;

    const workItem = createWorkItem(cockpitDir, { title: "Finish a run", repoTargets: [repoId] });
    const task = createTask(cockpitDir, {
      workItemId: workItem.id,
      title: "Run core work",
      repo: repoId,
      scopes: ["README.md"],
      risk: "low",
    });
    const claim = createClaim({
      cockpitDir,
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

    const agent = getAgent(cockpitDir, "manual-default");
    if (!agent) {
      throw new Error("Expected manual-default agent");
    }

    createRun({
      cockpitDir,
      runId: "RUN-test",
      task,
      workItem,
      agent,
      branch: "cockpit/test-run",
      worktreePath: root,
      claimIds: [claim.id],
    });

    await completeRun(cockpitDir, "RUN-test", "done");

    expect(listActiveClaims(cockpitDir)).toHaveLength(0);
    expect(fs.existsSync(path.join(cockpitDir, "claims", "archive", `${claim.id}.json`))).toBe(true);
  });

  it("releases active claims when a run is sent to review", async () => {
    const root = await createWorkspace();
    const cockpitDir = path.join(root, ".cockpit");
    const config = loadConfig(cockpitDir);
    const repoId = config.repos[0]!.id;

    const workItem = createWorkItem(cockpitDir, { title: "Review a run", repoTargets: [repoId] });
    const task = createTask(cockpitDir, {
      workItemId: workItem.id,
      title: "Review task",
      repo: repoId,
      scopes: ["README.md"],
      risk: "low",
    });
    const claim = createClaim({
      cockpitDir,
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

    const agent = getAgent(cockpitDir, "manual-default");
    if (!agent) {
      throw new Error("Expected manual-default agent");
    }

    createRun({
      cockpitDir,
      runId: "RUN-review",
      task,
      workItem,
      agent,
      branch: "cockpit/test-review",
      worktreePath: root,
      claimIds: [claim.id],
    });

    await sendRunToReview(cockpitDir, "RUN-review", "needs review");

    expect(listActiveClaims(cockpitDir)).toHaveLength(0);
    expect(loadRun(cockpitDir, "RUN-review")?.status).toBe("awaiting_review");
  });
});
