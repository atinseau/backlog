import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";
import { initLayout, loadConfig } from "@backlog/config";
import { git } from "@backlog/git";
import { addAgent } from "./agents.js";
import { buildExecutionPlan } from "./scheduler.js";
import { createSubTask } from "./subtask-service.js";
import { createTask } from "./task-service.js";
import { getRunEvents, loadRun } from "./run-store.js";
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

async function createPlainWorkspace(): Promise<{ root: string; backlogDir: string; repoId: string }> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-plain-launcher-"));
  initLayout({
    root,
    projectName: "plain-launcher-test",
    mode: "embedded",
    repos: [{ id: "plain", path: root, default_branch: "main", enabled: true, access_mode: "read-write" }],
  });
  return { root, backlogDir: path.join(root, ".backlog"), repoId: "plain" };
}

async function createRemoteWorkspace(): Promise<{ root: string; backlogDir: string; repoId: string; origin: string }> {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-remote-launcher-"));
  const seed = path.join(fixtureRoot, "seed");
  const origin = path.join(fixtureRoot, "origin.git");
  const root = path.join(fixtureRoot, "project");
  fs.mkdirSync(seed, { recursive: true });
  fs.mkdirSync(root, { recursive: true });

  await git(["init", "-b", "main"], seed);
  fs.writeFileSync(path.join(seed, "README.md"), "# remote demo\n", "utf8");
  await git(["add", "README.md"], seed);
  await git(["-c", "user.name=Backlog", "-c", "user.email=backlog@example.com", "commit", "-m", "init"], seed);
  await git(["clone", "--bare", seed, origin], fixtureRoot);

  initLayout({
    root,
    projectName: "remote-launcher-test",
    mode: "control_plane",
    repos: [
      {
        id: "cloud",
        default_branch: "main",
        enabled: true,
        access_mode: "read-write",
        location: "remote",
        remote_type: "git",
        remote_provider: "custom",
        remote_url: origin,
      },
    ],
  });
  return { root, backlogDir: path.join(root, ".backlog"), repoId: "cloud", origin };
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

  it("can run direct-mode tasks on a dirty checkout when explicitly allowed", async () => {
    addAgent(backlogDir, {
      id: "writer",
      provider: "custom",
      command: "node -e \"require('fs').writeFileSync('direct.txt', 'ok\\\\n')\"",
      successMode: "complete",
      allowedRepos: [repoId],
      allowedRisk: ["medium"],
    });
    const workItem = createTask(backlogDir, {
      title: "Write direct file anyway",
      repoTargets: [repoId],
      autoCommit: false,
      pushWhenDone: false,
      worktreeMode: "direct",
      preferredAgents: ["writer"],
    });
    createSubTask(backlogDir, {
      workItemId: workItem.id,
      title: "Write direct file anyway",
      repo: repoId,
      risk: "medium",
      preferredAgents: ["writer"],
    });
    fs.writeFileSync(path.join(root, "human-note.txt"), "do not stage me\n", "utf8");

    const config = loadConfig(backlogDir);
    const plan = buildExecutionPlan(backlogDir, config, { workItemId: workItem.id });
    const result = await startRunsForPlan({
      backlogDir,
      config,
      plan,
      maxStart: 1,
      forcedAgentId: "writer",
      allowDirtyDirect: true,
    });

    expect(result.skipped).toEqual([]);
    expect(result.started).toHaveLength(1);
    expect(fs.readFileSync(path.join(root, "human-note.txt"), "utf8")).toBe("do not stage me\n");
    expect(fs.readFileSync(path.join(root, "direct.txt"), "utf8")).toBe("ok\n");
    expect(getRunEvents(backlogDir, result.started[0]!.runId).some((line) => line.includes("workspace.direct_dirty_allowed"))).toBe(true);
  });

  it("runs direct-mode tasks in a normal folder without Git metadata", async () => {
    ({ root, backlogDir, repoId } = await createPlainWorkspace());
    addAgent(backlogDir, {
      id: "writer",
      provider: "custom",
      command: "node -e \"require('fs').writeFileSync('plain.txt', 'ok\\\\n')\"",
      successMode: "complete",
      allowedRepos: [repoId],
      allowedRisk: ["medium"],
    });
    const workItem = createTask(backlogDir, {
      title: "Write plain file",
      repoTargets: [repoId],
      autoCommit: true,
      pushWhenDone: false,
      worktreeMode: "direct",
      preferredAgents: ["writer"],
    });
    createSubTask(backlogDir, {
      workItemId: workItem.id,
      title: "Write plain file",
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
    expect(result.started[0]?.branch).toBe("local-folder");
    expect(fs.readFileSync(path.join(root, "plain.txt"), "utf8")).toBe("ok\n");

    const run = loadRun(backlogDir, result.started[0]!.runId);
    expect(run?.execution_mode).toBe("direct");
    expect(run?.status).toBe("succeeded");
    const events = getRunEvents(backlogDir, result.started[0]!.runId);
    expect(events.some((line) => line.includes("workspace.no_git"))).toBe(false);
    expect(events.some((line) => line.includes("run.commit_skipped"))).toBe(false);
    expect(events.some((line) => line.includes(`Working directly in ${root}`))).toBe(true);
  });

  it("prepares an isolated execution checkout for remote-only Git repositories", async () => {
    ({ root, backlogDir, repoId } = await createRemoteWorkspace());
    addAgent(backlogDir, {
      id: "writer",
      provider: "custom",
      command: "node -e \"require('fs').writeFileSync('remote.txt', 'ok\\\\n')\"",
      successMode: "complete",
      allowedRepos: [repoId],
      allowedRisk: ["medium"],
    });
    const workItem = createTask(backlogDir, {
      title: "Write remote file",
      repoTargets: [repoId],
      autoCommit: false,
      pushWhenDone: false,
      worktreeMode: "direct",
      preferredAgents: ["writer"],
    });
    createSubTask(backlogDir, {
      workItemId: workItem.id,
      title: "Write remote file",
      repo: repoId,
      risk: "medium",
      preferredAgents: ["writer"],
    });

    const config = loadConfig(backlogDir);
    const plan = buildExecutionPlan(backlogDir, config, { workItemId: workItem.id });
    const result = await startRunsForPlan({ backlogDir, config, plan, maxStart: 1, forcedAgentId: "writer" });

    expect(result.skipped).toEqual([]);
    expect(result.started).toHaveLength(1);
    const started = result.started[0]!;
    expect(started.worktreePath).toBe(path.join(backlogDir, "worktrees", repoId, started.runId));
    expect(fs.readFileSync(path.join(started.worktreePath, "README.md"), "utf8")).toBe("# remote demo\n");
    expect(fs.readFileSync(path.join(started.worktreePath, "remote.txt"), "utf8")).toBe("ok\n");

    const run = loadRun(backlogDir, started.runId);
    expect(run?.execution_mode).toBe("isolated_worktree");
    expect(run?.status).toBe("succeeded");
    expect(fs.existsSync(path.join(backlogDir, "remote-checkouts", repoId, started.runId, "repo", ".git"))).toBe(true);
    expect(getRunEvents(backlogDir, started.runId).some((line) => line.includes("workspace.remote_checkout"))).toBe(true);
    expect(getRunEvents(backlogDir, started.runId).some((line) => line.includes("workspace.mode_adjusted"))).toBe(true);
  });
});
