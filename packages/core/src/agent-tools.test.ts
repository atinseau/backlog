import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";
import { initLayout } from "@backlog/config";
import type { Agent } from "@backlog/schemas";
import { AGENT_TOOLS, agentToolNames, callAgentTool } from "./agent-tools.js";
import { taskExecutionTarget } from "./execution-target.js";
import { orchestratorToolNames } from "./orchestrator-tools.js";
import { executeAgentRun } from "./run-executor.js";
import { createRun, loadRun } from "./run-store.js";
import { createTask } from "./task-service.js";
import { listTraces } from "./trace-store.js";

interface Project {
  backlogDir: string;
  root: string;
  repoId: string;
  taskId: string;
  workItem: ReturnType<typeof createTask>;
}

function project(): Project {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-agent-tools-"));
  initLayout({
    root,
    projectName: "agent-tools-test",
    repos: [{ id: path.basename(root), path: root, default_branch: "main", enabled: true }],
  });
  const backlogDir = path.join(root, ".backlog");
  const repoId = path.basename(root);
  const task = createTask(backlogDir, { title: "Ship it", repoTargets: [repoId] });
  return { backlogDir, root, repoId, taskId: task.id, workItem: task };
}

describe("the agent tool set's boundary", () => {
  it("exposes exactly one tool", () => {
    expect(agentToolNames()).toEqual(["trace_write"]);
  });

  it("shares no name with the orchestrator set", () => {
    const agentNames = new Set(agentToolNames());
    for (const name of orchestratorToolNames()) {
      expect(agentNames.has(name)).toBe(false);
    }
  });

  it("refuses an orchestration tool by name, even when it is asked for confirmed", async () => {
    const { backlogDir } = project();

    for (const name of orchestratorToolNames()) {
      const outcome = await callAgentTool({ backlogDir, name, input: { confirmed: true } });
      expect(outcome.ok).toBe(false);
    }
  });
});

describe("trace_write", () => {
  it("records a trace, filling the context from the environment", async () => {
    const { backlogDir, taskId } = project();
    process.env.BACKLOG_RUN_ID = "run_agent_tools";
    process.env.BACKLOG_TASK_ID = taskId;

    try {
      const outcome = await callAgentTool({
        backlogDir,
        name: "trace_write",
        input: { outcome: "implemented", summary: "Renamed the widget" },
      });

      expect(outcome.ok).toBe(true);
      const traces = listTraces(backlogDir, taskId);
      expect(traces).toHaveLength(1);
      expect(traces[0]?.summary).toBe("Renamed the widget");
    } finally {
      delete process.env.BACKLOG_RUN_ID;
      delete process.env.BACKLOG_TASK_ID;
    }
  });

  it("records a trace on a task-level run, which has no subtask to name", async () => {
    // A task dispatched directly — no split — is a scheduler-produced shape
    // (run-launcher.ts, decision.targetType === "task"). Its ExecutionTarget.id
    // is a *task* id; exported as BACKLOG_SUBTASK_ID it made recordTrace look up
    // a subtask that cannot exist, and both write channels died on
    // "Unknown subtask: task_xxx". The environment is read back from a real run
    // rather than hand-built, so the assertion covers the export, not a guess.
    const { backlogDir, root, repoId, taskId, workItem } = project();
    const agent: Agent = {
      id: "custom-task-level",
      provider: "custom",
      command: 'printf \'{"task":"%s","subtask":"%s"}\' "${BACKLOG_TASK_ID-}" "${BACKLOG_SUBTASK_ID-}"',
      enabled: true,
      max_concurrent_runs: 1,
      allowed_repos: [],
      allowed_risk: ["low", "medium", "high"],
      capabilities: ["plan", "edit_code"],
      environment: {},
      retry_policy: { mode: "none", max_attempts: 1, reuse_worktree: true },
    };
    const target = taskExecutionTarget(workItem, repoId);
    const run = createRun({
      backlogDir,
      runId: "RUN-task-level-trace",
      task: target,
      workItem,
      agent,
      branch: "backlog/task-level",
      worktreePath: root,
      claimIds: [],
    });

    await executeAgentRun({ backlogDir, run, task: target, workItem, agent });
    const summary = loadRun(backlogDir, run.id)?.artifacts.find((artifact) => artifact.kind === "summary")?.value;
    const exported = JSON.parse(summary ?? "{}") as { task: string; subtask: string };
    expect(exported.task).toBe(taskId);
    expect(exported.subtask).toBe("");

    const previous = process.env.BACKLOG_SUBTASK_ID;
    process.env.BACKLOG_RUN_ID = run.id;
    process.env.BACKLOG_TASK_ID = exported.task;
    if (exported.subtask) {
      process.env.BACKLOG_SUBTASK_ID = exported.subtask;
    } else {
      delete process.env.BACKLOG_SUBTASK_ID;
    }

    try {
      const outcome = await callAgentTool({
        backlogDir,
        name: "trace_write",
        input: { outcome: "implemented", summary: "Shipped the whole task" },
      });

      expect(outcome).toEqual({
        ok: true,
        result: {
          recorded: true,
          task_id: taskId,
          outcome: "implemented",
          transitions: [],
          linked_dependencies: [],
          created_proposals: [],
        },
      });
      expect(listTraces(backlogDir, taskId)).toHaveLength(1);
    } finally {
      delete process.env.BACKLOG_RUN_ID;
      delete process.env.BACKLOG_TASK_ID;
      if (previous === undefined) delete process.env.BACKLOG_SUBTASK_ID;
      else process.env.BACKLOG_SUBTASK_ID = previous;
    }
  });

  it("returns the refusal, not an exception, when the payload is invalid", async () => {
    const { backlogDir, taskId } = project();

    const outcome = await callAgentTool({
      backlogDir,
      name: "trace_write",
      input: { outcome: "rejected", summary: "no", run_id: "run_1", task_id: taskId },
    });

    expect(outcome.ok).toBe(false);
    expect(JSON.stringify(outcome.result)).toContain("rejection_reason");
  });

  it("tells the agent how to recover when the run context never reached the tool", async () => {
    const { backlogDir } = project();
    const saved = { run: process.env.BACKLOG_RUN_ID, task: process.env.BACKLOG_TASK_ID };
    delete process.env.BACKLOG_RUN_ID;
    delete process.env.BACKLOG_TASK_ID;

    try {
      const outcome = await callAgentTool({
        backlogDir,
        name: "trace_write",
        input: { outcome: "implemented", summary: "Did the thing" },
      });

      expect(outcome.ok).toBe(false);
      const error = (outcome.result as { error: string }).error;
      // Not a raw Zod error: run_id and task_id are absent from inputSchema, so
      // the agent has to be told it may pass them anyway.
      expect(error).toContain("run_id");
      expect(error).toContain("task_id");
      expect(error).toContain("BACKLOG_RUN_ID");
    } finally {
      if (saved.run === undefined) delete process.env.BACKLOG_RUN_ID;
      else process.env.BACKLOG_RUN_ID = saved.run;
      if (saved.task === undefined) delete process.env.BACKLOG_TASK_ID;
      else process.env.BACKLOG_TASK_ID = saved.task;
    }
  });

  it("declares an input schema the model can fill without guessing", () => {
    const tool = AGENT_TOOLS.find((candidate) => candidate.name === "trace_write")!;
    const schema = tool.inputSchema as { required: string[]; properties: Record<string, unknown> };

    expect(schema.required).toEqual(["outcome", "summary"]);
    expect(Object.keys(schema.properties)).toContain("open_question");
    expect(Object.keys(schema.properties)).toContain("constraints");
  });
});
