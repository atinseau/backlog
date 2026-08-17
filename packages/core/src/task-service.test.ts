import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";
import { initLayout } from "@backlog/config";
import { git } from "@backlog/git";
import { createTask, removeTask, updateTask } from "./task-service.js";
import { createSubTask, getSubTask } from "./subtask-service.js";
import { listPendingSyncConflicts, recordStatusConflict } from "./sync-conflicts.js";

async function createProjectRoot(): Promise<string> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-work-"));
  await git(["init", "-b", "main"], root);
  fs.writeFileSync(path.join(root, "README.md"), "# backlog\n", "utf8");
  await git(["add", "README.md"], root);
  await git(["-c", "user.name=Backlog", "-c", "user.email=backlog@example.com", "commit", "-m", "init"], root);
  initLayout({ root, projectName: "work-test", mode: "embedded" });
  return root;
}

describe("task-service", () => {
  let backlogDir: string;

  beforeEach(async () => {
    backlogDir = path.join(await createProjectRoot(), ".backlog");
  });

  it("updates editable task fields and planning metadata", () => {
    const item = createTask(backlogDir, {
      title: "Initial task",
      description: "old description",
      repoTargets: ["backlog"],
      labels: ["old"],
      acceptanceCriteria: ["one"],
    });

    const updated = updateTask(backlogDir, item.id, {
      title: "Updated task",
      clearDescription: true,
      priority: "P0",
      repoTargets: ["backlog", "docs"],
      labels: ["scheduler", "cli"],
      acceptanceCriteria: ["new acceptance"],
      dependencies: ["WI-upstream"],
      planningRisk: "high",
      preferredLane: "backlog",
      splitStatus: "done",
    });

    expect(updated.title).toBe("Updated task");
    expect(updated.description).toBeUndefined();
    expect(updated.priority).toBe("P0");
    expect(updated.repo_targets).toEqual(["backlog", "docs"]);
    expect(updated.labels).toEqual(["scheduler", "cli"]);
    expect(updated.acceptance_criteria).toEqual(["new acceptance"]);
    expect(updated.dependencies).toEqual(["WI-upstream"]);
    expect(updated.planning.risk).toBe("high");
    expect(updated.planning.preferred_lane).toBe("backlog");
    expect(updated.planning.split_status).toBe("done");
  });

  it("removes a task and cascades linked subtasks when requested", () => {
    const item = createTask(backlogDir, {
      title: "Removable task",
      repoTargets: ["backlog"],
    });
    const task = createSubTask(backlogDir, {
      workItemId: item.id,
      title: "Linked task",
      repo: "backlog",
    });
    recordStatusConflict({
      backlogDir,
      taskId: item.id,
      sourceRef: "jira-main",
      localValue: "in_progress",
      externalValue: "backlog",
    });

    const removed = removeTask(backlogDir, item.id, { cascadeTasks: true });

    expect(removed.id).toBe(item.id);
    expect(removeTask.bind(null, backlogDir, item.id)).toThrowError;
    expect(getSubTask(backlogDir, task.id)).toBeNull();
    expect(listPendingSyncConflicts(backlogDir)).toHaveLength(0);
  });
});
