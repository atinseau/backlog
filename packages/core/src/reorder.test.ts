import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { initLayout } from "@backlog/config";
import { git } from "@backlog/git";
import { createTask, reorderTask } from "./task-service.js";
import { createWorkItem, reorderWorkItem } from "./work-service.js";
import { listTasks, listWorkItems } from "./state-files.js";

async function createWorkspace(): Promise<string> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-reorder-"));
  await git(["init", "-b", "main"], root);
  fs.writeFileSync(path.join(root, "README.md"), "# backlog\n", "utf8");
  await git(["add", "README.md"], root);
  await git(["-c", "user.name=Backlog", "-c", "user.email=backlog@example.com", "commit", "-m", "init"], root);
  initLayout({ root, workspaceName: "reorder-test", mode: "embedded" });
  return path.join(root, ".backlog");
}

describe("reorderTask", () => {
  let backlogDir: string;

  beforeEach(async () => {
    backlogDir = await createWorkspace();
  });

  it("moves a task to top via beforeId", () => {
    const wi = createWorkItem(backlogDir, { title: "Parent" });
    const t1 = createTask(backlogDir, { workItemId: wi.id, title: "T1", repo: "r" });
    const t2 = createTask(backlogDir, { workItemId: wi.id, title: "T2", repo: "r" });
    const t3 = createTask(backlogDir, { workItemId: wi.id, title: "T3", repo: "r" });

    reorderTask(backlogDir, { taskId: t3.id, beforeId: t1.id });
    const tasks = listTasks(backlogDir).filter((task) => task.work_item_id === wi.id);
    const ordered = tasks.sort((a, b) => b.priority_score - a.priority_score).map((t) => t.id);
    expect(ordered).toEqual([t3.id, t1.id, t2.id]);
  });

  it("moves a task after another via afterId", () => {
    const wi = createWorkItem(backlogDir, { title: "Parent" });
    const t1 = createTask(backlogDir, { workItemId: wi.id, title: "T1", repo: "r" });
    const t2 = createTask(backlogDir, { workItemId: wi.id, title: "T2", repo: "r" });
    const t3 = createTask(backlogDir, { workItemId: wi.id, title: "T3", repo: "r" });

    reorderTask(backlogDir, { taskId: t1.id, afterId: t2.id });
    const tasks = listTasks(backlogDir).filter((task) => task.work_item_id === wi.id);
    const ordered = tasks.sort((a, b) => b.priority_score - a.priority_score).map((t) => t.id);
    expect(ordered).toEqual([t2.id, t1.id, t3.id]);
  });

  it("uses sparse priority_scores 1000, 990, 980", () => {
    const wi = createWorkItem(backlogDir, { title: "Parent" });
    const t1 = createTask(backlogDir, { workItemId: wi.id, title: "T1", repo: "r" });
    const t2 = createTask(backlogDir, { workItemId: wi.id, title: "T2", repo: "r" });
    reorderTask(backlogDir, { taskId: t2.id, beforeId: t1.id });
    const tasks = listTasks(backlogDir);
    const reloadedT1 = tasks.find((t) => t.id === t1.id);
    const reloadedT2 = tasks.find((t) => t.id === t2.id);
    expect(reloadedT2?.priority_score).toBe(1000);
    expect(reloadedT1?.priority_score).toBe(990);
  });
});

describe("reorderWorkItem", () => {
  let backlogDir: string;

  beforeEach(async () => {
    backlogDir = await createWorkspace();
  });

  it("reorders within the same priority bucket", () => {
    const wi1 = createWorkItem(backlogDir, { title: "A", priority: "P1" });
    const wi2 = createWorkItem(backlogDir, { title: "B", priority: "P1" });
    const wi3 = createWorkItem(backlogDir, { title: "C", priority: "P1" });

    reorderWorkItem(backlogDir, { workItemId: wi3.id, beforeId: wi1.id });
    const items = listWorkItems(backlogDir).filter((wi) => wi.priority === "P1");
    const ordered = items.sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0)).map((wi) => wi.id);
    expect(ordered).toEqual([wi3.id, wi1.id, wi2.id]);
  });

  it("does not affect items in different priority buckets", () => {
    const wi1 = createWorkItem(backlogDir, { title: "A", priority: "P0" });
    const wi2 = createWorkItem(backlogDir, { title: "B", priority: "P1" });

    reorderWorkItem(backlogDir, { workItemId: wi2.id });
    const wi1Reloaded = listWorkItems(backlogDir).find((wi) => wi.id === wi1.id);
    expect(wi1Reloaded?.rank).toBeUndefined();
  });
});
