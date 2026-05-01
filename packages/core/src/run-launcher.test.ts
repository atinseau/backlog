import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { initLayout, loadConfig } from "@backlog/config";
import { git } from "@backlog/git";
import { addAgent } from "./agents.js";
import { buildExecutionPlan } from "./scheduler.js";
import { createSubTask } from "./subtask-service.js";
import { createTask } from "./task-service.js";
import { loadRun } from "./run-store.js";
import { startRunsForPlan } from "./run-launcher.js";

async function createWorkspace(): Promise<{ root: string; backlogDir: string; repoId: string }> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-launcher-"));
  await git(["init", "-b", "main"], root);
  fs.writeFileSync(path.join(root, "README.md"), "# demo\n", "utf8");
  fs.writeFileSync(path.join(root, ".gitignore"), ".backlog/\n", "utf8");
  await git(["add", "README.md", ".gitignore"], root);
  await git(["-c", "user.name=Backlog", "-c", "user.email=backlog@example.com", "commit", "-m", "init"], root);
  initLayout({
    root,
    projectName: "launcher-test",
    mode: "embedded",
    repos: [{ id: "demo", path: root, default_branch: "main", enabled: true, access_mode: "read-write" }],
  });
  return { root, backlogDir: path.join(root, ".backlog"), repoId: "demo" };
}

describe("run-launcher", () => {
  let root: string;
  let backlogDir: string;
  let repoId: string;

  beforeEach(async () => {
    ({ root, backlogDir, repoId } = await createWorkspace());
  });

  it("runs direct-mode tasks in the main checkout instead of an isolated worktree", async () => {
    addAgent(backlogDir, {
      id: "writer",
      provider: "custom",
      command: "node -e \"require('fs').writeFileSync('direct.txt', 'ok\\\\n')\"",
      successMode: "complete",
      allowedRepos: [repoId],
      allowedRisk: ["medium"],
    });
    const workItem = createTask(backlogDir, {
      title: "Write direct file",
      repoTargets: [repoId],
      autoCommit: false,
      pushWhenDone: false,
      worktreeMode: "direct",
      preferredAgents: ["writer"],
    });
    createSubTask(backlogDir, {
      workItemId: workItem.id,
      title: "Write direct file",
      repo: repoId,
      risk: "medium",
      preferredAgents: ["writer"],
    });

    const config = loadConfig(backlogDir);
    const plan = buildExecutionPlan(backlogDir, config, { workItemId: workItem.id });
    const result = await startRunsForPlan({ backlogDir, config, plan, maxStart: 1, forcedAgentId: "writer" });

    expect(result.skipped).toEqual([]);
    expect(result.started).toHaveLength(1);
    expect(result.started[0]?.worktreePath).toBe(root);
    expect(result.started[0]?.branch).toBe("main");
    expect(fs.readFileSync(path.join(root, "direct.txt"), "utf8")).toBe("ok\n");
    expect(fs.existsSync(path.join(root, ".backlog-executor.log"))).toBe(false);

    const run = loadRun(backlogDir, result.started[0]!.runId);
    expect(run?.execution_mode).toBe("direct");
    expect(run?.worktree_path).toBe(root);
    expect(run?.status).toBe("succeeded");
  });

  it("refuses direct-mode tasks when the main checkout is dirty", async () => {
    addAgent(backlogDir, {
      id: "writer",
      provider: "custom",
      command: "node -e \"require('fs').writeFileSync('direct.txt', 'ok\\\\n')\"",
      successMode: "complete",
      allowedRepos: [repoId],
      allowedRisk: ["medium"],
    });
    const workItem = createTask(backlogDir, {
      title: "Write direct file",
      repoTargets: [repoId],
      autoCommit: false,
      pushWhenDone: false,
      worktreeMode: "direct",
      preferredAgents: ["writer"],
    });
    createSubTask(backlogDir, {
      workItemId: workItem.id,
      title: "Write direct file",
      repo: repoId,
      risk: "medium",
      preferredAgents: ["writer"],
    });
    fs.writeFileSync(path.join(root, "human-note.txt"), "do not stage me\n", "utf8");

    const config = loadConfig(backlogDir);
    const plan = buildExecutionPlan(backlogDir, config, { workItemId: workItem.id });
    const result = await startRunsForPlan({ backlogDir, config, plan, maxStart: 1, forcedAgentId: "writer" });

    expect(result.started).toEqual([]);
    expect(result.skipped).toEqual([
      {
        taskId: expect.any(String),
        reasons: ["direct_checkout_dirty"],
      },
    ]);
    expect(fs.existsSync(path.join(root, "direct.txt"))).toBe(false);
  });
});
