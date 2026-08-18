import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";
import { initLayout, loadConfig } from "@backlog/config";
import { createSubTask } from "./subtask-service.js";
import { createTask, reorderTask } from "./task-service.js";
import { buildExecutionPlan } from "./scheduler.js";

function createWorkspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-core-"));
  initLayout({
    root,
    projectName: "test",
    repos: [{ id: path.basename(root), path: root, default_branch: "main", enabled: true }],
  });
  return root;
}

function writeAgentsFile(backlogDir: string, contents: string): void {
  fs.writeFileSync(path.join(backlogDir, "agents.yaml"), contents, "utf8");
}

// initLayout seeds real Claude providers, but CI does not have that
// CLI or its API keys. Tests that need a runnable plan use this helper
// to drop in an executable stand-in.
function writeExecutableAgent(backlogDir: string, capabilities: string[] = ["plan", "edit_code", "run_tests", "review"]): void {
  writeAgentsFile(
    backlogDir,
    [
      "version: 1",
      "agents:",
      "  - id: stub",
      "    provider: custom",
      "    command: /bin/true",
      "    enabled: true",
      "    max_concurrent_runs: 4",
      "    allowed_repos: []",
      "    allowed_risk: [low, medium, high]",
      `    capabilities: [${capabilities.join(", ")}]`,
      "    environment: {}",
      "",
    ].join("\n"),
  );
}

describe("buildExecutionPlan", () => {
  it("marks dependency-blocked tasks as waiting", () => {
    const root = createWorkspace();
    const backlogDir = path.join(root, ".backlog");
    writeExecutableAgent(backlogDir);
    const config = loadConfig(backlogDir);

    const work = createTask(backlogDir, { title: "Ship feature", repoTargets: [path.basename(root)] });
    const first = createSubTask(backlogDir, {
      workItemId: work.id,
      title: "First task",
      repo: path.basename(root),
      scopes: ["README.md"],
    });
    const second = createSubTask(backlogDir, {
      workItemId: work.id,
      title: "Second task",
      repo: path.basename(root),
      scopes: ["src/index.ts"],
      dependsOn: [first.id],
    });

    const plan = buildExecutionPlan(backlogDir, config);
    expect(plan.runnable.some((decision) => decision.taskId === first.id)).toBe(true);
    // The reason text changed in the dependency-state split:
    // pending deps now read `waiting_on:<id>`; failed deps read
    // `dependency_failed:<id>`. `first` here is queued, so `waiting_on`.
    expect(plan.waiting.find((decision) => decision.taskId === second.id)?.reasons).toContain(`waiting_on:${first.id}`);
  });

  it("does not schedule overlapping runnable tasks in the same plan", () => {
    const root = createWorkspace();
    const backlogDir = path.join(root, ".backlog");
    writeExecutableAgent(backlogDir);
    const config = loadConfig(backlogDir);

    const work = createTask(backlogDir, { title: "Split scheduler", repoTargets: [path.basename(root)] });
    const first = createSubTask(backlogDir, {
      workItemId: work.id,
      title: "Core planner",
      repo: path.basename(root),
      scopes: ["packages/core/src/**"],
      risk: "low",
    });
    const second = createSubTask(backlogDir, {
      workItemId: work.id,
      title: "Conflicting follow-up",
      repo: path.basename(root),
      scopes: ["packages/core/src/scheduler.ts"],
      risk: "low",
      priorityScore: 90,
    });

    const plan = buildExecutionPlan(backlogDir, config);
    expect(plan.runnable).toHaveLength(1);
    expect(plan.runnable.some((decision) => decision.taskId === first.id || decision.taskId === second.id)).toBe(true);
    expect(plan.waiting.some((decision) => decision.reasons.some((reason) => reason.startsWith("scope_conflict_with_selected:")))).toBe(true);
  });

  it("schedules runnable cards in board order within a priority bucket", () => {
    const root = createWorkspace();
    const backlogDir = path.join(root, ".backlog");
    writeExecutableAgent(backlogDir);
    const config = loadConfig(backlogDir);
    const repo = path.basename(root);

    const first = createTask(backlogDir, { title: "First on board", repoTargets: [repo], priority: "P2" });
    const second = createTask(backlogDir, { title: "Moved to top", repoTargets: [repo], priority: "P2" });
    reorderTask(backlogDir, { workItemId: second.id, beforeId: first.id });
    const firstSub = createSubTask(backlogDir, {
      workItemId: first.id,
      title: "First subtask",
      repo,
      scopes: ["first.txt"],
      risk: "low",
    });
    const secondSub = createSubTask(backlogDir, {
      workItemId: second.id,
      title: "Second subtask",
      repo,
      scopes: ["second.txt"],
      risk: "low",
    });

    const plan = buildExecutionPlan(backlogDir, config);
    expect(plan.runnable.map((decision) => decision.taskId).slice(0, 2)).toEqual([secondSub.id, firstSub.id]);
  });

  it("prefers an explicitly preferred compatible agent", () => {
    const root = createWorkspace();
    const backlogDir = path.join(root, ".backlog");
    const config = loadConfig(backlogDir);
    writeAgentsFile(
      backlogDir,
      [
        "version: 1",
        "agents:",
        "  - id: generic",
        "    provider: custom",
        "    command: /bin/true",
        "    enabled: true",
        "    max_concurrent_runs: 1",
        "    allowed_repos: []",
        "    allowed_risk: [low, medium, high]",
        "    capabilities: [plan, edit_code]",
        "    environment: {}",
        "  - id: preferred",
        "    provider: custom",
        "    command: /bin/true",
        "    enabled: true",
        "    max_concurrent_runs: 1",
        "    allowed_repos: []",
        "    allowed_risk: [low, medium, high]",
        "    capabilities: [plan, edit_code, run_tests]",
        "    environment: {}",
        "",
      ].join("\n"),
    );

    const work = createTask(backlogDir, { title: "Preferred agent", repoTargets: [path.basename(root)] });
    createSubTask(backlogDir, {
      workItemId: work.id,
      title: "Agent sensitive task",
      repo: path.basename(root),
      scopes: ["README.md"],
      risk: "low",
      preferredAgents: ["preferred"],
      requiredCapabilities: ["edit_code"],
    });

    const plan = buildExecutionPlan(backlogDir, config);
    expect(plan.runnable[0]?.assignedAgentId).toBe("preferred");
  });

  it("still schedules manual-approval tasks in assist mode", () => {
    const root = createWorkspace();
    const backlogDir = path.join(root, ".backlog");
    writeExecutableAgent(backlogDir);
    const config = loadConfig(backlogDir);
    config.autonomy_mode = "assist";

    const work = createTask(backlogDir, { title: "Review after run", repoTargets: [path.basename(root)] });
    const task = createSubTask(backlogDir, {
      workItemId: work.id,
      title: "Implement then wait for review",
      repo: path.basename(root),
      scopes: ["README.md"],
      risk: "low",
      manualApprovalRequired: true,
    });

    const plan = buildExecutionPlan(backlogDir, config);
    expect(plan.runnable.find((decision) => decision.taskId === task.id)).toBeTruthy();
    expect(plan.blocked.find((decision) => decision.taskId === task.id)?.reasons ?? []).not.toContain("manual_approval_required");
  });

  it("blocks tasks when no agent satisfies required capabilities", () => {
    const root = createWorkspace();
    const backlogDir = path.join(root, ".backlog");
    const config = loadConfig(backlogDir);

    const work = createTask(backlogDir, { title: "Capability mismatch", repoTargets: [path.basename(root)] });
    const task = createSubTask(backlogDir, {
      workItemId: work.id,
      title: "Needs tests",
      repo: path.basename(root),
      scopes: ["README.md"],
      risk: "low",
      // The seeded agents have a generous capability list (plan, edit_code,
      // run_tests, review, shell, git_read, git_write). Pick something
      // outside that set so we exercise the "blocked" code path.
      requiredCapabilities: ["build_image"],
    });

    const plan = buildExecutionPlan(backlogDir, config);
    expect(plan.blocked.find((decision) => decision.taskId === task.id)?.reasons).toContain("no_compatible_agent");
  });

  it("does not schedule against a disabled repository", () => {
    const root = createWorkspace();
    const backlogDir = path.join(root, ".backlog");
    writeExecutableAgent(backlogDir);

    const work = createTask(backlogDir, { title: "Off-limits", repoTargets: [path.basename(root)] });
    const task = createSubTask(backlogDir, {
      workItemId: work.id,
      title: "Should not run",
      repo: path.basename(root),
      scopes: ["README.md"],
      risk: "low",
    });

    const config = loadConfig(backlogDir);
    config.repos[0]!.enabled = false;

    const plan = buildExecutionPlan(backlogDir, config);
    expect(plan.blocked.find((decision) => decision.taskId === task.id)?.reasons).toContain("repository_disabled");
    expect(plan.runnable.find((decision) => decision.taskId === task.id)).toBeUndefined();
  });
});
