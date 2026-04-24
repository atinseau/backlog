import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initLayout, loadConfig } from "@backlog/config";
import { readTasksFile } from "./state-files.js";
import { resolveSplitRepos, splitWorkItem } from "./split-service.js";
import { createWorkItem, getWorkItem } from "./work-service.js";

function createWorkspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-split-"));
  initLayout({
    root,
    workspaceName: "test",
    repos: [
      { id: "backend", path: root, default_branch: "main", enabled: true },
      { id: "app", path: root, default_branch: "main", enabled: true },
    ],
  });
  return root;
}

describe("splitWorkItem", () => {
  it("creates one serial task per repo and marks the work item as split", () => {
    const root = createWorkspace();
    const backlogDir = path.join(root, ".backlog");
    const config = loadConfig(backlogDir);
    const workItem = createWorkItem(backlogDir, {
      title: "Ship orchestrator",
      repoTargets: ["backend", "app"],
      acceptanceCriteria: ["Tests pass", "Status is explainable"],
    });

    const repos = resolveSplitRepos(config, getWorkItem(backlogDir, workItem.id)!, []);
    const result = splitWorkItem(backlogDir, {
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

    const tasksFile = readTasksFile(backlogDir);
    expect(tasksFile.tasks).toHaveLength(2);
    expect(getWorkItem(backlogDir, workItem.id)?.planning.split_status).toBe("done");
  });
});
