import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";
import { initLayout } from "@backlog/config";
import { git } from "@backlog/git";
import { createSubTask, createTask, getSubTask, listTraces } from "@backlog/core";
import { readTraceFromStdin, runTraceShow, runTraceWrite } from "./trace.js";

async function createWorkspace(): Promise<string> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-cli-trace-"));
  await git(["init", "-b", "main"], root);
  fs.writeFileSync(path.join(root, "README.md"), "# backlog\n", "utf8");
  await git(["add", "README.md"], root);
  await git(["-c", "user.name=Backlog", "-c", "user.email=b@e.com", "commit", "-m", "init"], root);
  initLayout({
    root,
    projectName: "cli-trace-test",
    mode: "embedded",
    repos: [{ id: "backlog", path: root, default_branch: "main", enabled: true, access_mode: "read-write" }],
  });
  return root;
}

describe("backlog trace", () => {
  let root: string;
  let backlogDir: string;
  let taskId: string;
  let subtaskId: string;

  beforeEach(async () => {
    root = await createWorkspace();
    backlogDir = path.join(root, ".backlog");
    taskId = createTask(backlogDir, { title: "Harden the store" }).id;
    subtaskId = createSubTask(backlogDir, {
      workItemId: taskId,
      title: "Guard the writer",
      repo: "backlog",
    }).id;
  });

  it("writes a trace from a JSON payload and reports the transitions", () => {
    const result = runTraceWrite(backlogDir, {
      version: 1,
      run_id: "run_001",
      task_id: taskId,
      subtask_id: subtaskId,
      created_at: "2026-08-17T10:00:00.000Z",
      outcome: "blocked",
      summary: "Stuck on credentials.",
      open_question: "Which credential should it use?",
    });
    expect(listTraces(backlogDir, taskId)).toHaveLength(1);
    expect(getSubTask(backlogDir, subtaskId)!.status).toBe("blocked");
    expect(result.transitions).toHaveLength(1);
  });

  it("fills run ids from the environment when the payload omits them", () => {
    const previous = { run: process.env.BACKLOG_RUN_ID, task: process.env.BACKLOG_TASK_ID };
    process.env.BACKLOG_RUN_ID = "run_042";
    process.env.BACKLOG_TASK_ID = taskId;
    try {
      runTraceWrite(backlogDir, {
        outcome: "implemented",
        summary: "Done.",
      });
      expect(listTraces(backlogDir, taskId)[0]!.run_id).toBe("run_042");
    } finally {
      process.env.BACKLOG_RUN_ID = previous.run;
      process.env.BACKLOG_TASK_ID = previous.task;
    }
  });

  it("reports a validation error instead of writing a partial trace", () => {
    expect(() =>
      runTraceWrite(backlogDir, {
        version: 1,
        run_id: "run_001",
        task_id: taskId,
        created_at: "2026-08-17T10:00:00.000Z",
        outcome: "rejected",
        summary: "Not worth it.",
      }),
    ).toThrow(/rejection_reason/);
    expect(listTraces(backlogDir, taskId)).toHaveLength(0);
  });

  it("shows the traces of a task in chronological order", () => {
    runTraceWrite(backlogDir, {
      version: 1, run_id: "run_001", task_id: taskId,
      created_at: "2026-08-17T10:00:00.000Z", outcome: "implemented", summary: "first",
    });
    runTraceWrite(backlogDir, {
      version: 1, run_id: "run_002", task_id: taskId,
      created_at: "2026-08-17T11:00:00.000Z", outcome: "implemented", summary: "second",
    });
    const lines = runTraceShow(backlogDir, taskId);
    expect(lines.join("\n")).toContain("first");
    expect(lines.join("\n")).toContain("second");
    expect(lines.join("\n").indexOf("first")).toBeLessThan(lines.join("\n").indexOf("second"));
  });

  it("says so plainly when a task has no trace", () => {
    expect(runTraceShow(backlogDir, taskId).join("\n")).toContain("No trace");
  });

  it("parses a JSON payload from a stdin stream", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"outcome":'));
        controller.enqueue(new TextEncoder().encode('"implemented","summary":"ok"}'));
        controller.close();
      },
    });
    expect(await readTraceFromStdin(stream)).toEqual({ outcome: "implemented", summary: "ok" });
  });
});
