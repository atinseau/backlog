import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initLayout, loadConfig } from "@backlog/config";
import { readSubTasksFile } from "./state-files.js";
import { resolveSplitRepos, splitTask } from "./split-service.js";
import { createTask, getTask } from "./task-service.js";

function createWorkspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-split-"));
  initLayout({
    root,
    projectName: "test",
    repos: [
      { id: "backend", path: root, default_branch: "main", enabled: true },
      { id: "app", path: root, default_branch: "main", enabled: true },
    ],
  });
  return root;
}

describe("splitTask", () => {
  it("creates one serial task per repo and marks the task as split", () => {
    const root = createWorkspace();
    const backlogDir = path.join(root, ".backlog");
    const config = loadConfig(backlogDir);
    const workItem = createTask(backlogDir, {
      title: "Ship orchestrator",
      repoTargets: ["backend", "app"],
      acceptanceCriteria: ["Tests pass", "Status is explainable"],
    });

    const repos = resolveSplitRepos(config, getTask(backlogDir, workItem.id)!, []);
    const result = splitTask(backlogDir, {
      workItemId: workItem.id,
      repos,
      mode: "serial",
      scopeByRepo: {
        backend: ["packages/core/src/**"],
        app: ["packages/cli/src/**"],
      },
    });

    expect(result.createdTasks).toHaveLength(2);
    expect(result.createdTasks[1]?.depends_on).toEqual([result.createdTasks[0]!.id]);
    expect(result.createdTasks[0]?.completion.done_when).toEqual(["Tests pass", "Status is explainable"]);

    const tasksFile = readSubTasksFile(backlogDir);
    expect(tasksFile.subtasks).toHaveLength(2);
    expect(getTask(backlogDir, workItem.id)?.planning.split_status).toBe("done");
  });
});
