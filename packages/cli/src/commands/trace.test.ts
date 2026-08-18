import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";
import { Command } from "commander";
import { initLayout } from "@backlog/config";
import { git } from "@backlog/git";
import { appendTrace, createSubTask, createTask, getSubTask, listTraces } from "@backlog/core";
import { readTraceFromStdin, registerTraceCommand, runTraceCheck, runTraceShow, runTraceWrite } from "./trace.js";

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
    repos: [{ id: "backlog", path: root, default_branch: "main", enabled: true }],
  });
  return root;
}

/**
 * Drives the real, wired `trace check` subcommand end to end (not just the
 * plain `runTraceCheck` helper) and reports the `process.exitCode` it set --
 * that assignment is the actual contract Task 3's Stop hook depends on, so
 * it has to be observed directly rather than inferred from a return value.
 * `process.exitCode` is process-global and this suite shares one process
 * (see CLAUDE.md), so it is saved before the parse and restored after,
 * regardless of outcome.
 */
async function runTraceCheckCommand(args: string[]): Promise<number | undefined> {
  const program = new Command();
  program.name("test").exitOverride();
  registerTraceCommand(program);
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    await program.parseAsync(["node", "test", "trace", "check", ...args], { from: "node" });
    return process.exitCode;
  } finally {
    process.exitCode = previousExitCode;
  }
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

  it("exits 0 when a trace exists for the run and 1 when it does not", () => {
    appendTrace(backlogDir, {
      version: 1,
      run_id: "run_present",
      task_id: taskId,
      outcome: "implemented",
      summary: "did the thing",
      created_at: "2026-08-18T00:00:00.000Z",
      constraints: [],
      decisions: [],
      discovered_deps: [],
      consolidation_hint: "none",
    });

    expect(runTraceCheck(backlogDir, "run_present", taskId)).toBe(0);
    expect(runTraceCheck(backlogDir, "run_absent", taskId)).toBe(1);
  });

  describe("the wired `trace check` command", () => {
    // These three cases are Task 3's entire contract with this subcommand:
    // the Stop hook reads nothing but the exit code. `runTraceCheck` above
    // only proves the lookup logic; these prove the CLI wiring actually sets
    // `process.exitCode` to what that logic returned (or, on failure, to a
    // code distinct from both 0 and 1).
    it("sets exit code 0 when a trace exists for the run", async () => {
      appendTrace(backlogDir, {
        version: 1,
        run_id: "run_present",
        task_id: taskId,
        outcome: "implemented",
        summary: "did the thing",
        created_at: "2026-08-18T00:00:00.000Z",
        constraints: [],
        decisions: [],
        discovered_deps: [],
        consolidation_hint: "none",
      });

      const exitCode = await runTraceCheckCommand([
        "--project",
        backlogDir,
        "--run",
        "run_present",
        "--task",
        taskId,
      ]);

      expect(exitCode).toBe(0);
    });

    it("sets exit code 1 when no trace exists for the run", async () => {
      const exitCode = await runTraceCheckCommand([
        "--project",
        backlogDir,
        "--run",
        "run_absent",
        "--task",
        taskId,
      ]);

      expect(exitCode).toBe(1);
    });

    it("sets an exit code other than 0 or 1 when the check itself fails", async () => {
      // No .backlog project lives here, so resolveBacklogDir throws inside the
      // action. The hook must be able to tell this apart from "no trace" (1) --
      // that is the whole point of catching it locally in trace.ts instead of
      // letting bin.ts's global catch-all turn every error into exit 1.
      const unresolvable = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-cli-trace-noproject-"));

      const exitCode = await runTraceCheckCommand([
        "--project",
        unresolvable,
        "--run",
        "run_present",
        "--task",
        taskId,
      ]);

      expect(exitCode).not.toBe(0);
      expect(exitCode).not.toBe(1);
    });
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

  it("reassembles a multi-byte character split across two stdin chunks", async () => {
    // The chunk boundary lands *inside* "é" (0xC3 0xA9), which is the only split
    // a non-streaming decode gets wrong — and trace prose is accented text. An
    // ASCII boundary would pass either way, so it proves nothing.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new Uint8Array([...new TextEncoder().encode('{"summary":"trait'), 0xc3]),
        );
        controller.enqueue(new Uint8Array([0xa9, ...new TextEncoder().encode('"}')]));
        controller.close();
      },
    });
    expect(await readTraceFromStdin(stream)).toEqual({ summary: "traité" });
  });

  it("names the problem when the payload is not valid JSON", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"outcome":"implemented",}'));
        controller.close();
      },
    });
    await expect(readTraceFromStdin(stream)).rejects.toThrow(/not valid JSON/);
  });
});
