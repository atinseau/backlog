import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "bun:test";
import { writeStopHook, type StopHookBinary } from "./stop-hook.js";

function scratch(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "backlog-stophook-"));
}

// Stands in for the `backlog` binary, answering `trace check` with the exit code
// under test: 0 the trace exists, 1 it does not, 2 the check itself failed. It
// writes its own argv to `argv.txt` so a test can assert what the hook called.
function fakeBacklog(dir: string, exitCode: number, prefixArgs: string[] = []): StopHookBinary {
  const fake = path.join(dir, `fake-backlog-${exitCode}`);
  const argvPath = path.join(dir, "argv.txt");
  fs.writeFileSync(fake, `#!/usr/bin/env bash\nprintf '%s\\n' "$@" > '${argvPath}'\nexit ${exitCode}\n`, "utf8");
  fs.chmodSync(fake, 0o755);
  return { command: fake, prefixArgs };
}

function argvOf(dir: string): string[] {
  return fs.readFileSync(path.join(dir, "argv.txt"), "utf8").split("\n").filter(Boolean);
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

function identity(dir: string): Record<string, string> {
  return { BACKLOG_RUN_ID: "run_1", BACKLOG_TASK_ID: "task_1", BACKLOG_PROJECT_DIR: dir };
}

describe("writeStopHook", () => {
  it("allows the stop once it has already blocked, whatever the trace says", () => {
    const dir = scratch();
    const hook = writeStopHook(dir, fakeBacklog(dir, 1));

    expect(runHook(hook, { stop_hook_active: true }, identity(dir)).status).toBe(0);
  });

  it("allows the stop when the run carries no identity", () => {
    const dir = scratch();
    const hook = writeStopHook(dir, fakeBacklog(dir, 1));

    expect(runHook(hook, { stop_hook_active: false }, { BACKLOG_RUN_ID: "", BACKLOG_TASK_ID: "", BACKLOG_PROJECT_DIR: "" }).status).toBe(0);
  });

  it("allows the stop when the binary it was given is gone — it fails open", () => {
    const dir = scratch();
    const hook = writeStopHook(dir, { command: path.join(dir, "does-not-exist"), prefixArgs: [] });

    expect(runHook(hook, { stop_hook_active: false }, identity(dir)).status).toBe(0);
  });

  it("blocks the stop when the check reports a missing trace", () => {
    const dir = scratch();
    const hook = writeStopHook(dir, fakeBacklog(dir, 1));

    const result = runHook(hook, { stop_hook_active: false }, identity(dir));

    expect(result.status).toBe(2);
    // The block is only useful if it tells the model what to call.
    expect(result.stderr).toContain("trace_write");
  });

  // Exit 1 is the *only* answer that may block. These two pin that down: without
  // them, `if [[ $status -ne 1 ]]` could be weakened to `-eq 0` and every other
  // test would still pass.
  it("allows the stop when the check finds the trace", () => {
    const dir = scratch();
    const hook = writeStopHook(dir, fakeBacklog(dir, 0));

    expect(runHook(hook, { stop_hook_active: false }, identity(dir)).status).toBe(0);
  });

  it("allows the stop when the check itself failed — it never blocks on a broken check", () => {
    const dir = scratch();
    const hook = writeStopHook(dir, fakeBacklog(dir, 2));

    expect(runHook(hook, { stop_hook_active: false }, identity(dir)).status).toBe(0);
  });

  it("calls the binary it was handed, with the run's identity", () => {
    const dir = scratch();
    const hook = writeStopHook(dir, fakeBacklog(dir, 0));

    runHook(hook, { stop_hook_active: false }, identity(dir));

    expect(argvOf(dir)).toEqual([
      "trace",
      "check",
      "--project",
      dir,
      "--run",
      "run_1",
      "--task",
      "task_1",
    ]);
  });

  // In a dev tree `selfExec()` answers `bun <entrypoint>`, so the prefix args
  // have to reach the CLI ahead of the subcommand — and an empty array must not
  // trip `set -u` on bash 3.2, which the cases above cover.
  it("passes the prefix arguments ahead of the subcommand", () => {
    const dir = scratch();
    const hook = writeStopHook(dir, fakeBacklog(dir, 0, ["--smol", "/src/bin.ts"]));

    runHook(hook, { stop_hook_active: false }, identity(dir));

    expect(argvOf(dir).slice(0, 4)).toEqual(["--smol", "/src/bin.ts", "trace", "check"]);
  });

  // A concurrent run's `claude` may be executing this file while another run
  // writes it. A rename swaps the inode, so the reader keeps the whole script it
  // opened; a truncating write would hand it a bash syntax error, which exits 2.
  it("replaces the script atomically and leaves no staging file behind", () => {
    const dir = scratch();
    writeStopHook(dir, fakeBacklog(dir, 0));
    const hook = writeStopHook(dir, fakeBacklog(dir, 0));

    expect(fs.readdirSync(path.join(dir, "bin"))).toEqual(["stop-hook"]);
    expect(fs.statSync(hook).mode & 0o111).toBeGreaterThan(0);
  });
});
