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

// Appended to a fixture agent's command when a test needs the run to finish
// as recorded, not merely exit-0 — `executeAgentRun` fails a run that
// produces no trace, and one custom-command fixture in this file exercises
// the full pipeline through to a `succeeded` status.
const RECORD_TRACE =
  `mkdir -p "$BACKLOG_PROJECT_DIR/traces" && printf '{"version":1,"run_id":"%s","task_id":"%s","outcome":"implemented","summary":"fixture","created_at":"2026-08-18T00:00:00.000Z"}\\n' "$BACKLOG_RUN_ID" "$BACKLOG_TASK_ID" >> "$BACKLOG_PROJECT_DIR/traces/$BACKLOG_TASK_ID.ndjson"`;

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
    repos: [{ id: "demo", path: root, default_branch: "main", enabled: true }],
  });
  return { root, backlogDir: path.join(root, ".backlog"), repoId: "demo" };
}

async function makeProjectWithNonGitCheckout(): Promise<{ root: string; backlogDir: string; repoId: string; checkoutPath: string }> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-nongit-launcher-"));
  initLayout({
    root,
    projectName: "nongit-launcher-test",
    mode: "embedded",
    repos: [{ id: "plain", path: root, default_branch: "main", enabled: true }],
  });
  return { root, backlogDir: path.join(root, ".backlog"), repoId: "plain", checkoutPath: root };
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
  let backlogDir: string;
  let repoId: string;

  beforeEach(async () => {
    ({ backlogDir, repoId } = await createWorkspace());
  });

  it("a repository whose checkout is not a git repository is skipped, not run directly", async () => {
    const { backlogDir: nonGitBacklogDir, repoId: nonGitRepoId, checkoutPath } = await makeProjectWithNonGitCheckout();
    addAgent(nonGitBacklogDir, {
      id: "writer",
      provider: "custom",
      command: "node -e \"require('fs').writeFileSync('plain.txt', 'ok\\\\n')\"",
      successMode: "complete",
      allowedRepos: [nonGitRepoId],
      allowedRisk: ["medium"],
    });
    const workItem = createTask(nonGitBacklogDir, {
      title: "Write plain file",
      repoTargets: [nonGitRepoId],
      autoCommit: true,
      pushWhenDone: false,
      preferredAgents: ["writer"],
    });
    createSubTask(nonGitBacklogDir, {
      workItemId: workItem.id,
      title: "Write plain file",
      repo: nonGitRepoId,
      risk: "medium",
      preferredAgents: ["writer"],
    });

    const config = loadConfig(nonGitBacklogDir);
    const plan = buildExecutionPlan(nonGitBacklogDir, config, { workItemId: workItem.id });
    const result = await startRunsForPlan({ backlogDir: nonGitBacklogDir, config, plan, maxStart: 1, forcedAgentId: "writer" });

    expect(result.started).toHaveLength(0);
    expect(result.skipped[0]?.reasons).toContain("repository_not_a_git_repository");
    expect(fs.existsSync(path.join(checkoutPath, ".backlog-agent-prompt.md"))).toBe(false);
  });

  it("prepares an isolated execution checkout for remote-only Git repositories", async () => {
    ({ backlogDir, repoId } = await createRemoteWorkspace());
    addAgent(backlogDir, {
      id: "writer",
      provider: "custom",
      command: `node -e \"require('fs').writeFileSync('remote.txt', 'ok\\\\n')\"; ${RECORD_TRACE}`,
      successMode: "complete",
      allowedRepos: [repoId],
      allowedRisk: ["medium"],
    });
    const workItem = createTask(backlogDir, {
      title: "Write remote file",
      repoTargets: [repoId],
      autoCommit: false,
      pushWhenDone: false,
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
    expect(run?.status).toBe("succeeded");
    expect(fs.existsSync(path.join(backlogDir, "remote-checkouts", repoId, started.runId, "repo", ".git"))).toBe(true);
    expect(getRunEvents(backlogDir, started.runId).some((line) => line.includes("workspace.remote_checkout"))).toBe(true);
  });
});
