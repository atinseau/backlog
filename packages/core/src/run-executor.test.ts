import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";
import { initLayout } from "@backlog/config";
import type { Agent } from "@backlog/schemas";
import { executeAgentRun } from "./run-executor.js";
import { createRun, getRunEvents, getRunHandoffPath, loadRun } from "./run-store.js";
import { createSubTask } from "./subtask-service.js";
import { createTask } from "./task-service.js";
import { subTaskExecutionTarget } from "./execution-target.js";

interface Fixture {
  backlogDir: string;
  root: string;
  agent: Agent;
  run: ReturnType<typeof createRun>;
  task: ReturnType<typeof subTaskExecutionTarget>;
  workItem: ReturnType<typeof createTask>;
}

let runCounter = 0;

/**
 * A project with one repository, one task and one queued run, wired to a
 * `custom` agent whose command is the given shell snippet. Custom is the
 * simplest runtime to make behave on demand, which keeps these tests about
 * the shared pipeline rather than about any one provider.
 */
function fixture(command: string, agentOverrides: Partial<Agent> = {}): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-run-executor-"));
  initLayout({
    root,
    projectName: "run-executor-test",
    repos: [{ id: path.basename(root), path: root, default_branch: "main", enabled: true }],
  });
  const backlogDir = path.join(root, ".backlog");
  const repoId = path.basename(root);

  const workItem = createTask(backlogDir, { title: "Run executor", repoTargets: [repoId] });
  const subTask = createSubTask(backlogDir, {
    workItemId: workItem.id,
    title: "Do the work",
    repo: repoId,
    scopes: ["README.md"],
    risk: "low",
    ...(agentOverrides.id ? {} : {}),
  });
  const task = subTaskExecutionTarget(subTask);

  const agent: Agent = {
    id: "custom-test",
    provider: "custom",
    command,
    enabled: true,
    max_concurrent_runs: 1,
    allowed_repos: [],
    allowed_risk: ["low", "medium"],
    capabilities: ["plan", "edit_code"],
    environment: {},
    retry_policy: { mode: "none", max_attempts: 1, reuse_worktree: true },
    ...agentOverrides,
  };

  const run = createRun({
    backlogDir,
    runId: `RUN-${++runCounter}`,
    task,
    workItem,
    agent,
    branch: "backlog/test",
    worktreePath: root,
    claimIds: [],
  });

  return { backlogDir, root, agent, run, task, workItem };
}

function eventTypes(backlogDir: string, runId: string): string[] {
  return getRunEvents(backlogDir, runId)
    .map((line) => {
      try {
        return (JSON.parse(line) as { type?: string }).type ?? "";
      } catch {
        return "";
      }
    })
    .filter(Boolean);
}

describe("executeAgentRun", () => {
  it("finalizes a successful run and records the agent's summary", async () => {
    const f = fixture("echo 'Renamed the widget'");

    const handled = await executeAgentRun({ ...f, run: f.run });

    expect(handled).toBe(true);
    const run = loadRun(f.backlogDir, f.run.id);
    expect(run?.status).toBe("succeeded");
    expect(run?.artifacts.find((artifact) => artifact.kind === "summary")?.value).toBe("Renamed the widget");
  });

  it("stamps no CLI role of its own, because it cannot know a façade replaced it", async () => {
    // `custom` attaches no MCP server, so its run has no Backlog tools at all.
    // Closing the CLI here would leave it with no channel — no trace, a ticket
    // that never moves, and nothing in the run saying why. The role belongs to
    // the runtime that hands the façade out.
    const f = fixture('printf "%s" "${BACKLOG_AGENT_ROLE-none}"');

    await executeAgentRun({ ...f, run: f.run });

    expect(loadRun(f.backlogDir, f.run.id)?.artifacts.find((a) => a.kind === "summary")?.value).toBe("none");
  });

  it("does not let a role inherited from the shell stand in for one", async () => {
    const f = fixture('printf "%s" "${BACKLOG_AGENT_ROLE-none}"');
    process.env.BACKLOG_AGENT_ROLE = "execution";

    try {
      await executeAgentRun({ ...f, run: f.run });
    } finally {
      delete process.env.BACKLOG_AGENT_ROLE;
    }

    expect(loadRun(f.backlogDir, f.run.id)?.artifacts.find((a) => a.kind === "summary")?.value).toBe("none");
  });

  it("writes the prompt the agent was given, for later inspection", async () => {
    const f = fixture("true");

    await executeAgentRun({ ...f, run: f.run });

    const prompt = fs.readFileSync(path.join(f.root, ".backlog-agent-prompt.md"), "utf8");
    expect(prompt).toContain("Do the work");
    expect(prompt).toContain("Allowed scopes:");
  });

  it("keeps the executor log as a run artifact", async () => {
    const f = fixture("echo out; echo err >&2");

    await executeAgentRun({ ...f, run: f.run });

    expect(loadRun(f.backlogDir, f.run.id)?.artifacts.some((artifact) => artifact.kind === "log")).toBe(true);
    const log = fs.readFileSync(path.join(f.root, ".backlog-agent.log"), "utf8");
    expect(log).toContain("out");
    expect(log).toContain("err");
  });

  it("brackets the run with start and success events", async () => {
    const f = fixture("true");

    await executeAgentRun({ ...f, run: f.run });

    const types = eventTypes(f.backlogDir, f.run.id);
    expect(types).toContain("executor.start");
    expect(types).toContain("executor.success");
  });

  it("fails the run and writes a handoff when the runtime exits non-zero", async () => {
    const f = fixture("exit 2");

    await executeAgentRun({ ...f, run: f.run });

    expect(loadRun(f.backlogDir, f.run.id)?.status).toBe("failed");
    expect(eventTypes(f.backlogDir, f.run.id)).toContain("executor.failed");
    const handoff = getRunHandoffPath(f.backlogDir, f.run.id);
    expect(handoff).not.toBeNull();
    expect(fs.readFileSync(handoff!, "utf8")).toContain("exit code 2");
  });

  it("sends the run to review when the subtask requires manual approval", async () => {
    const f = fixture("true");
    // Re-create the subtask with approval required, then re-run against it.
    const approved = createSubTask(f.backlogDir, {
      workItemId: f.workItem.id,
      title: "Needs approval",
      repo: f.task.repo,
      scopes: ["README.md"],
      risk: "low",
      manualApprovalRequired: true,
    });
    const task = subTaskExecutionTarget(approved);
    const run = createRun({
      backlogDir: f.backlogDir,
      runId: "RUN-approval",
      task,
      workItem: f.workItem,
      agent: f.agent,
      branch: "backlog/approval",
      worktreePath: f.root,
      claimIds: [],
    });

    await executeAgentRun({ backlogDir: f.backlogDir, run, task, workItem: f.workItem, agent: f.agent });

    expect(loadRun(f.backlogDir, "RUN-approval")?.status).toBe("awaiting_review");
  });

  it("reports an unsupported provider instead of silently doing nothing", async () => {
    const f = fixture("true", { provider: "telepathy" });

    const handled = await executeAgentRun({ ...f, run: f.run });

    expect(handled).toBe(false);
  });

  it("feeds the previous failure back into a retry prompt", async () => {
    const f = fixture("true");

    await executeAgentRun({
      ...f,
      run: f.run,
      attemptNumber: 2,
      priorFailureFeedback: "TypeError: cannot read property of undefined",
    });

    const prompt = fs.readFileSync(path.join(f.root, ".backlog-agent-prompt.md"), "utf8");
    expect(prompt).toContain("retry attempt 2");
    expect(prompt).toContain("TypeError: cannot read property of undefined");
  });

  it("refuses to run against a repository set to no-access", async () => {
    const f = fixture("true");
    const { loadConfig, saveConfig } = await import("@backlog/config");
    const config = loadConfig(f.backlogDir);
    config.repos[0]!.access_mode = "no-access";
    saveConfig(f.backlogDir, config);

    await expect(executeAgentRun({ ...f, run: f.run })).rejects.toThrow(/no-access/);
  });

  it("coerces the agent to read-only against a read-only repository", async () => {
    const captured = path.join(os.tmpdir(), `backlog-sandbox-${Date.now()}.txt`);
    const f = fixture(`printf '%s' "$BACKLOG_SANDBOX_MODE" > ${JSON.stringify(captured)}`, {
      sandbox_mode: "workspace-write",
    });
    const { loadConfig, saveConfig } = await import("@backlog/config");
    const config = loadConfig(f.backlogDir);
    config.repos[0]!.access_mode = "read-only";
    saveConfig(f.backlogDir, config);

    await executeAgentRun({ ...f, run: f.run });

    expect(fs.readFileSync(captured, "utf8")).toBe("read-only");
  });

  it("points every command the agent runs at the real project, not the worktree's shadow copy", async () => {
    // An in_repo worktree contains its own tracked .backlog/config.toml, so
    // findProject() would resolve to it and the agent would read and write a
    // project that is deleted with the worktree.
    const f = fixture('echo "$BACKLOG_PROJECT_DIR"');

    await executeAgentRun({ ...f, run: f.run });

    const run = loadRun(f.backlogDir, f.run.id);
    expect(run?.artifacts.find((artifact) => artifact.kind === "summary")?.value).toBe(f.backlogDir);
  });
});
