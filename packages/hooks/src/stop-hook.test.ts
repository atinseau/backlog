import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "bun:test";
import { writeStopHook } from "./stop-hook.js";

function scratch(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "backlog-stophook-"));
}

// The hook's whole contract is its exit code, so drive it the way `claude`
// does: the stdin payload on stdin, the run's identity in the environment.
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

function runHook(hookPath: string, payload: unknown, env: Record<string, string>): number {
  try {
    execFileSync(hookPath, [], { input: JSON.stringify(payload), env: { ...process.env, ...env } });
    return 0;
  } catch (error) {
    return (error as { status?: number }).status ?? -1;
  }
}

describe("writeStopHook", () => {
  it("allows the stop once it has already blocked, whatever the trace says", () => {
    const dir = scratch();
    const hook = writeStopHook(dir);

    expect(runHook(hook, { stop_hook_active: true }, { BACKLOG_RUN_ID: "run_1", BACKLOG_TASK_ID: "task_1", BACKLOG_PROJECT_DIR: dir })).toBe(0);
  });

  it("allows the stop when the run carries no identity", () => {
    const dir = scratch();
    const hook = writeStopHook(dir);

    expect(runHook(hook, { stop_hook_active: false }, { BACKLOG_RUN_ID: "", BACKLOG_TASK_ID: "", BACKLOG_PROJECT_DIR: "" })).toBe(0);
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
    ).toBe(0);
  });

  it("blocks the stop when the check reports a missing trace", () => {
    const dir = scratch();
    const hook = writeStopHook(dir);
    const fake = path.join(dir, "fake-backlog");
    fs.writeFileSync(fake, "#!/usr/bin/env bash\nexit 1\n", "utf8");
    fs.chmodSync(fake, 0o755);

    expect(
      runHook(hook, { stop_hook_active: false }, {
        BACKLOG_RUN_ID: "run_1",
        BACKLOG_TASK_ID: "task_1",
        BACKLOG_PROJECT_DIR: dir,
        BACKLOG_DEV_BIN: fake,
      }),
    ).toBe(2);
  });
});
