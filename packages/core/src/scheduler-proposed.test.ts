import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";
import { initLayout, loadConfig } from "@backlog/config";
import { git } from "@backlog/git";
import { buildExecutionPlan } from "./scheduler.js";
import { createSubTask } from "./subtask-service.js";
import { createTask, updateTaskStatus } from "./task-service.js";

async function createWorkspace(): Promise<string> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-sched-prop-"));
  await git(["init", "-b", "main"], root);
  fs.writeFileSync(path.join(root, "README.md"), "# backlog\n", "utf8");
  await git(["add", "README.md"], root);
  await git(["-c", "user.name=Backlog", "-c", "user.email=b@e.com", "commit", "-m", "init"], root);
  initLayout({
    root,
    projectName: "sched-prop-test",
    mode: "embedded",
    repos: [{ id: "backlog", path: root, default_branch: "main", enabled: true, access_mode: "read-write" }],
  });
  return root;
}

describe("scheduler and the proposed status", () => {
  let root: string;
  let backlogDir: string;

  beforeEach(async () => {
    root = await createWorkspace();
    backlogDir = path.join(root, ".backlog");
  });

  it("never returns a proposed task as runnable", () => {
    const task = createTask(backlogDir, { title: "Proposed work", status: "proposed" });
    createSubTask(backlogDir, { workItemId: task.id, title: "Do it", repo: "backlog" });
    const plan = buildExecutionPlan(backlogDir, loadConfig(backlogDir));
    expect(plan.runnable.map((d) => d.workItemId)).not.toContain(task.id);
  });

  it("never returns a proposed task even when explicitly targeted", () => {
    const task = createTask(backlogDir, { title: "Proposed work", status: "proposed" });
    const subtask = createSubTask(backlogDir, {
      workItemId: task.id,
      title: "Do it",
      repo: "backlog",
    });
    const plan = buildExecutionPlan(backlogDir, loadConfig(backlogDir), {
      workItemId: task.id,
      taskId: subtask.id,
    });
    expect(plan.runnable).toEqual([]);
  });

  it("still returns a task that was accepted into backlog when targeted", () => {
    const task = createTask(backlogDir, { title: "Accepted work", status: "proposed" });
    createSubTask(backlogDir, { workItemId: task.id, title: "Do it", repo: "backlog" });
    updateTaskStatus(backlogDir, task.id, "backlog");
    const plan = buildExecutionPlan(backlogDir, loadConfig(backlogDir), { workItemId: task.id });
    expect(plan.runnable.map((d) => d.workItemId)).toContain(task.id);
  });
});
