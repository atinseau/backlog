import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "bun:test";
import { initLayout } from "@backlog/config";
import { createTask } from "../task-service.js";
import { callReadTool, READ_TOOLS } from "./read-tools.js";

// Mirrors project() in ../agent-tools.test.ts — kept local rather than a
// shared helper, since this is the only other suite that needs it.
function makeTempProject(): { backlogDir: string; taskId: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-read-tools-"));
  initLayout({
    root,
    projectName: "read-tools-test",
    repos: [{ id: path.basename(root), path: root, default_branch: "main", enabled: true }],
  });
  const backlogDir = path.join(root, ".backlog");
  const repoId = path.basename(root);
  const task = createTask(backlogDir, { title: "Ship it", repoTargets: [repoId] });
  return { backlogDir, taskId: task.id };
}

test("the read surface is exactly four tools", () => {
  expect(READ_TOOLS.map((tool) => tool.name).sort()).toEqual([
    "claim_list",
    "subtask_show",
    "task_show",
    "trace_show",
  ]);
});

test("task_show returns the ticket", async () => {
  const { backlogDir, taskId } = makeTempProject();
  const outcome = await callReadTool({ backlogDir, name: "task_show", input: { task_id: taskId } });
  expect(outcome.ok).toBe(true);
  expect((outcome.result as { task: { id: string } }).task.id).toBe(taskId);
});

test("an unknown task is a readable refusal, not a throw", async () => {
  const { backlogDir } = makeTempProject();
  const outcome = await callReadTool({ backlogDir, name: "task_show", input: { task_id: "task_999" } });
  expect(outcome.ok).toBe(false);
  expect(String((outcome.result as { error: string }).error)).toContain("task_999");
});

test("the dispatcher refuses a name outside the read surface", async () => {
  const { backlogDir } = makeTempProject();
  const outcome = await callReadTool({ backlogDir, name: "start_subtask", input: { confirmed: true } });
  expect(outcome.ok).toBe(false);
  expect(String((outcome.result as { error: string }).error)).toContain("Unknown tool");
});
