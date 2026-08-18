import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "bun:test";
import { writeStopHook } from "./stop-hook.js";

function scratch(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "backlog-stophook-"));
}

// A PATH that resolves the script's interpreter and the tools it calls, but
// provably not `backlog`. Emptying PATH outright would stop `/usr/bin/env` from
// finding `bash`, so the hook would never run and the test would measure the
// shebang rather than the binary resolution it means to.
function pathWithoutBacklog(dir: string): string {
  const binDir = path.join(dir, "isolated-bin");
  fs.mkdirSync(binDir, { recursive: true });
  for (const tool of ["bash", "cat", "grep"]) {
    const resolved = execFileSync("/bin/sh", ["-c", `command -v ${tool}`], { encoding: "utf8" }).trim();
    fs.symlinkSync(resolved, path.join(binDir, tool));
  }
  return binDir;
}

// Stands in for the `backlog` binary, answering `trace check` with the exit code
// under test: 0 the trace exists, 1 it does not, 2 the check itself failed.
function fakeBacklog(dir: string, exitCode: number): string {
  const fake = path.join(dir, `fake-backlog-${exitCode}`);
  fs.writeFileSync(fake, `#!/usr/bin/env bash\nexit ${exitCode}\n`, "utf8");
  fs.chmodSync(fake, 0o755);
  return fake;
}

// The hook's whole contract is its exit code, so drive it the way `claude`
// does: the stdin payload on stdin, the run's identity in the environment.
// stderr is captured rather than inherited — it is the hook's only channel to
// the model, so it is worth asserting on, and it keeps the suite's output clean.
function runHook(
  hookPath: string,
  payload: unknown,
  env: Record<string, string>,
): { status: number; stderr: string } {
  try {
    execFileSync(hookPath, [], {
      input: JSON.stringify(payload),
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
      encoding: "utf8",
    });
    return { status: 0, stderr: "" };
  } catch (error) {
    const failure = error as { status?: number; stderr?: string | Buffer };
    return { status: failure.status ?? -1, stderr: String(failure.stderr ?? "") };
  }
}

describe("writeStopHook", () => {
  it("allows the stop once it has already blocked, whatever the trace says", () => {
    const dir = scratch();
    const hook = writeStopHook(dir);

    expect(runHook(hook, { stop_hook_active: true }, { BACKLOG_RUN_ID: "run_1", BACKLOG_TASK_ID: "task_1", BACKLOG_PROJECT_DIR: dir }).status).toBe(0);
  });

  it("allows the stop when the run carries no identity", () => {
    const dir = scratch();
    const hook = writeStopHook(dir);

    expect(runHook(hook, { stop_hook_active: false }, { BACKLOG_RUN_ID: "", BACKLOG_TASK_ID: "", BACKLOG_PROJECT_DIR: "" }).status).toBe(0);
  });

  it("allows the stop when the binary cannot be found — it fails open", () => {
    const dir = scratch();
    const hook = writeStopHook(dir);

    expect(
      runHook(hook, { stop_hook_active: false }, {
        BACKLOG_RUN_ID: "run_1",
        BACKLOG_TASK_ID: "task_1",
        BACKLOG_PROJECT_DIR: dir,
        BACKLOG_DEV_BIN: path.join(dir, "does-not-exist"),
        PATH: pathWithoutBacklog(dir),
        HOME: dir,
      }),
    ).toMatchObject({ status: 0 });
  });

  it("blocks the stop when the check reports a missing trace", () => {
    const dir = scratch();
    const hook = writeStopHook(dir);

    const result = runHook(hook, { stop_hook_active: false }, {
      BACKLOG_RUN_ID: "run_1",
      BACKLOG_TASK_ID: "task_1",
      BACKLOG_PROJECT_DIR: dir,
      BACKLOG_DEV_BIN: fakeBacklog(dir, 1),
    });

    expect(result.status).toBe(2);
    // The block is only useful if it tells the model what to call.
    expect(result.stderr).toContain("trace_write");
  });

  // Exit 1 is the *only* answer that may block. These two pin that down: without
  // them, `if [[ $status -ne 1 ]]` could be weakened to `-eq 0` and every other
  // test would still pass.
  it("allows the stop when the check finds the trace", () => {
    const dir = scratch();
    const hook = writeStopHook(dir);

    expect(
      runHook(hook, { stop_hook_active: false }, {
        BACKLOG_RUN_ID: "run_1",
        BACKLOG_TASK_ID: "task_1",
        BACKLOG_PROJECT_DIR: dir,
        BACKLOG_DEV_BIN: fakeBacklog(dir, 0),
      }).status,
    ).toBe(0);
  });

  it("allows the stop when the check itself failed — it never blocks on a broken check", () => {
    const dir = scratch();
    const hook = writeStopHook(dir);

    expect(
      runHook(hook, { stop_hook_active: false }, {
        BACKLOG_RUN_ID: "run_1",
        BACKLOG_TASK_ID: "task_1",
        BACKLOG_PROJECT_DIR: dir,
        BACKLOG_DEV_BIN: fakeBacklog(dir, 2),
      }).status,
    ).toBe(0);
  });
});
