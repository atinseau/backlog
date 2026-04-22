import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initLayout, loadConfig } from "@cockpit-ai/config";
import { createTask } from "./task-service.js";
import { createWorkItem } from "./work-service.js";
import { buildExecutionPlan } from "./scheduler.js";

function createWorkspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cockpit-core-"));
  initLayout({
    root,
    workspaceName: "test",
    repos: [{ id: path.basename(root), path: root, default_branch: "main", enabled: true }],
  });
  return root;
}

function writeAgentsFile(cockpitDir: string, contents: string): void {
  fs.writeFileSync(path.join(cockpitDir, "agents.yaml"), contents, "utf8");
}

describe("buildExecutionPlan", () => {
  it("marks dependency-blocked tasks as waiting", () => {
    const root = createWorkspace();
    const cockpitDir = path.join(root, ".cockpit");
    const config = loadConfig(cockpitDir);

    const work = createWorkItem(cockpitDir, { title: "Ship feature", repoTargets: [path.basename(root)] });
    const first = createTask(cockpitDir, {
      workItemId: work.id,
      title: "First task",
      repo: path.basename(root),
      scopes: ["README.md"],
    });
    const second = createTask(cockpitDir, {
      workItemId: work.id,
      title: "Second task",
      repo: path.basename(root),
      scopes: ["src/index.ts"],
      dependsOn: [first.id],
    });

    const plan = buildExecutionPlan(cockpitDir, config);
    expect(plan.runnable.some((decision) => decision.taskId === first.id)).toBe(true);
    expect(plan.waiting.find((decision) => decision.taskId === second.id)?.reasons).toContain(`blocked_by_dependency:${first.id}`);
  });

  it("does not schedule overlapping runnable tasks in the same plan", () => {
    const root = createWorkspace();
    const cockpitDir = path.join(root, ".cockpit");
    const config = loadConfig(cockpitDir);

    const work = createWorkItem(cockpitDir, { title: "Split scheduler", repoTargets: [path.basename(root)] });
    const first = createTask(cockpitDir, {
      workItemId: work.id,
      title: "Core planner",
      repo: path.basename(root),
      scopes: ["packages/core/src/**"],
      risk: "low",
    });
    const second = createTask(cockpitDir, {
      workItemId: work.id,
      title: "Conflicting follow-up",
      repo: path.basename(root),
      scopes: ["packages/core/src/scheduler.ts"],
      risk: "low",
      priorityScore: 90,
    });

    const plan = buildExecutionPlan(cockpitDir, config);
    expect(plan.runnable).toHaveLength(1);
    expect(plan.runnable.some((decision) => decision.taskId === first.id || decision.taskId === second.id)).toBe(true);
    expect(plan.waiting.some((decision) => decision.reasons.some((reason) => reason.startsWith("scope_conflict_with_selected:")))).toBe(true);
  });

  it("prefers an explicitly preferred compatible agent", () => {
    const root = createWorkspace();
    const cockpitDir = path.join(root, ".cockpit");
    const config = loadConfig(cockpitDir);
    writeAgentsFile(
      cockpitDir,
      [
        "version: 1",
        "agents:",
        "  - id: generic",
        "    provider: manual",
        "    enabled: true",
        "    max_concurrent_runs: 1",
        "    allowed_repos: []",
        "    allowed_risk: [low, medium, high]",
        "    capabilities: [plan, edit_code]",
        "    environment: {}",
        "  - id: preferred",
        "    provider: manual",
        "    enabled: true",
        "    max_concurrent_runs: 1",
        "    allowed_repos: []",
        "    allowed_risk: [low, medium, high]",
        "    capabilities: [plan, edit_code, run_tests]",
        "    environment: {}",
        "",
      ].join("\n"),
    );

    const work = createWorkItem(cockpitDir, { title: "Preferred agent", repoTargets: [path.basename(root)] });
    createTask(cockpitDir, {
      workItemId: work.id,
      title: "Agent sensitive task",
      repo: path.basename(root),
      scopes: ["README.md"],
      risk: "low",
      preferredAgents: ["preferred"],
      requiredCapabilities: ["edit_code"],
    });

    const plan = buildExecutionPlan(cockpitDir, config);
    expect(plan.runnable[0]?.assignedAgentId).toBe("preferred");
  });

  it("blocks tasks when no agent satisfies required capabilities", () => {
    const root = createWorkspace();
    const cockpitDir = path.join(root, ".cockpit");
    const config = loadConfig(cockpitDir);

    const work = createWorkItem(cockpitDir, { title: "Capability mismatch", repoTargets: [path.basename(root)] });
    const task = createTask(cockpitDir, {
      workItemId: work.id,
      title: "Needs tests",
      repo: path.basename(root),
      scopes: ["README.md"],
      risk: "low",
      requiredCapabilities: ["run_tests"],
    });

    const plan = buildExecutionPlan(cockpitDir, config);
    expect(plan.blocked.find((decision) => decision.taskId === task.id)?.reasons).toContain("no_compatible_agent");
  });
});
