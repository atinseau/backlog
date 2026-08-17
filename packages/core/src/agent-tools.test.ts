import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";
import { initLayout } from "@backlog/config";
import { AGENT_TOOLS, agentToolNames, callAgentTool } from "./agent-tools.js";
import { orchestratorToolNames } from "./orchestrator-tools.js";
import { createTask } from "./task-service.js";
import { listTraces } from "./trace-store.js";

function project(): { backlogDir: string; taskId: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-agent-tools-"));
  initLayout({
    root,
    projectName: "agent-tools-test",
    repos: [{ id: path.basename(root), path: root, default_branch: "main", enabled: true }],
  });
  const backlogDir = path.join(root, ".backlog");
  const task = createTask(backlogDir, { title: "Ship it", repoTargets: [path.basename(root)] });
  return { backlogDir, taskId: task.id };
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

  it("declares an input schema the model can fill without guessing", () => {
    const tool = AGENT_TOOLS.find((candidate) => candidate.name === "trace_write")!;
    const schema = tool.inputSchema as { required: string[]; properties: Record<string, unknown> };

    expect(schema.required).toEqual(["outcome", "summary"]);
    expect(Object.keys(schema.properties)).toContain("open_question");
    expect(Object.keys(schema.properties)).toContain("constraints");
  });
});
