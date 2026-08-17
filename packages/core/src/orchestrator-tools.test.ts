import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";
import { initLayout } from "@backlog/config";
import {
  ORCHESTRATOR_TOOLS,
  callOrchestratorTool,
  isWriteTool,
  orchestratorToolNames,
} from "./orchestrator-tools.js";
import { createTask } from "./task-service.js";
import { createSubTask } from "./subtask-service.js";

let backlogDir: string;

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-orchestrator-tools-"));
  initLayout({
    root,
    projectName: "tools-test",
    repos: [{ id: "backlog", path: root, default_branch: "main", enabled: true }],
  });
  backlogDir = path.join(root, ".backlog");
});

describe("ORCHESTRATOR_TOOLS", () => {
  it("declares every tool the chat exposes", () => {
    expect(orchestratorToolNames().sort()).toEqual([
      "get_git_settings",
      "get_orchestrator_state",
      "get_run_events",
      "list_runs",
      "list_tasks",
      "pause_orchestrator",
      "start_orchestrator",
      "start_subtask",
      "stop_orchestrator",
    ]);
  });

  it("gives every tool a description and an input schema", () => {
    for (const tool of ORCHESTRATOR_TOOLS) {
      expect(tool.description.length).toBeGreaterThan(20);
      expect(tool.inputSchema.type).toBe("object");
    }
  });

  it("marks the four state-changing tools as writes", () => {
    expect(ORCHESTRATOR_TOOLS.filter((tool) => isWriteTool(tool.name)).map((tool) => tool.name).sort()).toEqual([
      "pause_orchestrator",
      "start_orchestrator",
      "start_subtask",
      "stop_orchestrator",
    ]);
  });
});

describe("callOrchestratorTool", () => {
  it("lists tasks with their subtasks", async () => {
    const workItem = createTask(backlogDir, { title: "Visible task", repoTargets: ["backlog"] });
    createSubTask(backlogDir, {
      workItemId: workItem.id,
      title: "A subtask",
      repo: "backlog",
      risk: "low",
    });

    const outcome = await callOrchestratorTool({ backlogDir, name: "list_tasks", input: {} });
    const result = outcome.result as { count: number; tasks: Array<{ id: string; subtasks: unknown[] }> };

    expect(outcome.ok).toBe(true);
    expect(result.count).toBe(1);
    expect(result.tasks[0]?.subtasks).toHaveLength(1);
  });

  it("filters tasks by status", async () => {
    createTask(backlogDir, { title: "Backlog item", repoTargets: ["backlog"] });

    const outcome = await callOrchestratorTool({ backlogDir, name: "list_tasks", input: { status: "done" } });

    expect((outcome.result as { count: number }).count).toBe(0);
  });

  it("reports the orchestrator state", async () => {
    const outcome = await callOrchestratorTool({ backlogDir, name: "get_orchestrator_state", input: {} });

    expect((outcome.result as { mode: string }).mode).toBe("idle");
  });

  it("reports git settings in plain terms", async () => {
    const outcome = await callOrchestratorTool({ backlogDir, name: "get_git_settings", input: {} });

    expect(outcome.result).toHaveProperty("merge_strategy");
    expect(outcome.result).toHaveProperty("branch_strategy");
  });

  it("returns an empty list when nothing is running", async () => {
    const outcome = await callOrchestratorTool({ backlogDir, name: "list_runs", input: {} });

    expect((outcome.result as { count: number }).count).toBe(0);
  });

  it("rejects an unknown tool by name", async () => {
    const outcome = await callOrchestratorTool({ backlogDir, name: "launch_the_missiles", input: {} });

    expect(outcome.ok).toBe(false);
    expect(JSON.stringify(outcome.result)).toContain("launch_the_missiles");
  });

  it("reports a missing required argument instead of throwing", async () => {
    const outcome = await callOrchestratorTool({ backlogDir, name: "get_run_events", input: {} });

    expect(outcome.ok).toBe(false);
    expect(JSON.stringify(outcome.result)).toContain("run_id");
  });
});

describe("the confirmation gate on write tools", () => {
  it("refuses to act until the caller passes confirmed:true", async () => {
    const outcome = await callOrchestratorTool({
      backlogDir,
      name: "start_orchestrator",
      input: {},
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.result).toMatchObject({ status: "awaiting_confirmation" });
  });

  it("says so explicitly when confirmed is false", async () => {
    const outcome = await callOrchestratorTool({
      backlogDir,
      name: "pause_orchestrator",
      input: { confirmed: false },
    });

    expect(outcome.result).toMatchObject({ status: "awaiting_confirmation" });
  });

  it("acts once confirmed", async () => {
    const outcome = await callOrchestratorTool({
      backlogDir,
      name: "pause_orchestrator",
      input: { confirmed: true },
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.result).toMatchObject({ action: "pause_orchestrator" });
  });

  it("never gates a read tool", async () => {
    const outcome = await callOrchestratorTool({ backlogDir, name: "list_runs", input: {} });

    expect(outcome.ok).toBe(true);
  });

  it("requires a target for start_subtask", async () => {
    const outcome = await callOrchestratorTool({
      backlogDir,
      name: "start_subtask",
      input: { confirmed: true },
    });

    expect(outcome.ok).toBe(false);
    expect(JSON.stringify(outcome.result)).toMatch(/subtask_id|task_id/);
  });
});
