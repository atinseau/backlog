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
});
