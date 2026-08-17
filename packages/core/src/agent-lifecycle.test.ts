import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";
import { initLayout } from "@backlog/config";
import { addAgent, deleteAgent, getAgent, listAgents, selectionForAgentTask } from "./agents.js";
import { createRun } from "./run-store.js";
import { createSubTask } from "./subtask-service.js";
import { createTask } from "./task-service.js";
import { subTaskExecutionTarget } from "./execution-target.js";

let backlogDir: string;

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-agent-lifecycle-"));
  initLayout({
    root,
    projectName: "agent-lifecycle-test",
    repos: [{ id: "backlog", path: root, default_branch: "main", enabled: true }],
  });
  backlogDir = path.join(root, ".backlog");
});

describe("addAgent", () => {
  it("creates an agent on the canonical claude-code provider id", () => {
    const agent = addAgent(backlogDir, { id: "my-claude", provider: "claude-code" });

    expect(agent.provider).toBe("claude-code");
    expect(getAgent(backlogDir, "my-claude")?.provider).toBe("claude-code");
  });

  it("seeds sensible defaults so a new agent is usable straight away", () => {
    const agent = addAgent(backlogDir, { id: "my-claude", provider: "claude-code" });

    expect(agent.enabled).toBe(true);
    expect(agent.max_concurrent_runs).toBe(1);
    expect(agent.allowed_repos).toEqual([]);
    expect(agent.allowed_risk).toEqual(["low", "medium"]);
    expect(agent.capabilities).toContain("edit_code");
  });

  it("records the auth mode when one is chosen", () => {
    const agent = addAgent(backlogDir, {
      id: "plan-only",
      provider: "claude-code",
      authMode: "subscription",
    });

    expect(agent.auth_mode).toBe("subscription");
  });

  it("rejects a provider no runtime backs", () => {
    expect(() => addAgent(backlogDir, { id: "psychic", provider: "telepathy" })).toThrow(
      /telepathy/,
    );
  });

  it("names the runtimes it does know, so the error is actionable", () => {
    expect(() => addAgent(backlogDir, { id: "psychic", provider: "telepathy" })).toThrow(
      /claude-code/,
    );
  });

  it("refuses a duplicate id", () => {
    addAgent(backlogDir, { id: "my-claude", provider: "claude-code" });

    expect(() => addAgent(backlogDir, { id: "my-claude", provider: "claude-code" })).toThrow(
      /already exists/,
    );
  });

  it("requires a command for a runtime that has no binary of its own", () => {
    expect(() => addAgent(backlogDir, { id: "mine", provider: "custom" })).toThrow(/command/i);
  });

  it("accepts a custom agent once it carries a command", () => {
    const agent = addAgent(backlogDir, { id: "mine", provider: "custom", command: "./run.sh" });

    expect(agent.command).toBe("./run.sh");
  });
});

describe("a freshly added agent", () => {
  it("can be targeted at a subtask", () => {
    addAgent(backlogDir, { id: "my-claude", provider: "claude-code", command: process.execPath });
    const workItem = createTask(backlogDir, { title: "New agent run", repoTargets: ["backlog"] });
    const subTask = createSubTask(backlogDir, {
      workItemId: workItem.id,
      title: "Do it",
      repo: "backlog",
      risk: "low",
    });

    const selection = selectionForAgentTask(backlogDir, subTask, "my-claude");

    expect(selection?.available).toBe(true);
  });
});

describe("deleteAgent", () => {
  it("removes the agent", () => {
    addAgent(backlogDir, { id: "my-claude", provider: "claude-code" });

    deleteAgent(backlogDir, "my-claude");

    expect(listAgents(backlogDir).some((agent) => agent.id === "my-claude")).toBe(false);
  });

  it("refuses an unknown id", () => {
    expect(() => deleteAgent(backlogDir, "ghost")).toThrow(/Unknown agent/);
  });

  it("refuses while a run is still active for it", () => {
    const agent = addAgent(backlogDir, { id: "my-claude", provider: "claude-code" });
    const workItem = createTask(backlogDir, { title: "Busy", repoTargets: ["backlog"] });
    const subTask = createSubTask(backlogDir, {
      workItemId: workItem.id,
      title: "Running",
      repo: "backlog",
      risk: "low",
    });
    createRun({
      backlogDir,
      runId: "RUN-busy",
      task: subTaskExecutionTarget(subTask),
      workItem,
      agent,
      branch: "backlog/busy",
      worktreePath: backlogDir,
      claimIds: [],
    });

    expect(() => deleteAgent(backlogDir, "my-claude")).toThrow(/active run/);
  });
});
