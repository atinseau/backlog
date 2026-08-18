# A Run That Records Nothing Has Failed — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** A coding run that exits 0 without recording a trace for its own `run_id` fails, instead of finalizing as a success nobody can act on.

**Architecture:** Two mechanisms, one authority. The run finalizer checks the trace store before `finalizeSuccessfulRun` and takes the `failRun` path when no trace carries this run's id — it is the single place every exit-0 run of every runtime passes, so a `custom` run is covered by the same code. A Claude Code `Stop` hook is a net in front of it: it refuses the session's first attempt to end without a trace, which sends the model back to write one, and it never changes a run's status.

**Tech Stack:** Bun 1.3+ (runtime, package manager, test runner, bundler), TypeScript, Zod (`packages/schemas`), Commander (`packages/cli`), POSIX shell for the generated hook.

**Spec:** [docs/superpowers/specs/2026-08-18-traceless-run-design.md](../specs/2026-08-18-traceless-run-design.md)

## Global Constraints

- **Bun only.** No Node, npm, pnpm, tsx, tsup or vitest. Verification is `bun run typecheck`, `bun run test`, `bun run build`.
- **`bun test` with no path argument silently misses packages.** Always pass a path. `bun run test` scopes it to `./packages`.
- **After touching `packages/core/src/providers/`, run `bun test ./packages/core/src/providers` on its own.** A subset run over that directory is a *stricter* check than the full suite — file order in the full suite has masked a module-init bug there before.
- **No unused code, no dead code.** A symbol that survives with no reader is a defect in this repository.
- **The generated hook must fail open.** It blocks the stop **only** when the check positively reports a missing trace. Any other outcome — the binary is absent, the project cannot be resolved, the identity env vars are missing — allows the stop. A guardrail that hangs an agent is worse than no guardrail, and the finalizer is the authority regardless.
- **Never resolve runtime files relative to `import.meta.url`, and never re-invoke the CLI via `process.argv[1]`.** Inside the single binary both are `/$bunfs/` paths. Use `selfExec()` from `packages/core/src/self-exec.ts` — note that path; CLAUDE.md §4 cites `packages/cli/src/self-exec.ts`, which does not exist.
- **Use `homeDir()` from `@backlog/config`, never `os.homedir()`.** Bun resolves `os.homedir()` from the password database and ignores a reassigned `HOME`; the suite sandboxes `HOME`.
- Internal packages import each other with a `.js` extension resolving to `.ts` (`./static.js` → `static.ts`).
- Baseline before this plan: **781 pass / 0 fail across 95 files**.

## Facts established by probe, which this plan depends on

All measured on `claude` 2.1.234, the installed version. Do not re-derive them.

- `--settings` accepts a JSON **string** as well as a file path, and it is **additive** on top of the user's own settings, not a replacement.
- One `--settings` string can carry `env` and `hooks` **simultaneously**; both take effect.
- The accepted hook shape is exactly:
  `{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"<path>"}]}]}}`
- A `Stop` hook fires under `claude -p`, and **exiting 2 blocks the stop**: the hook's stderr reaches the model as a synthetic user message of the form `Stop hook feedback:\n[<hook path>]: <stderr>\n`, and the model takes another turn.
- The hook's stdin JSON has 11 keys — `session_id`, `transcript_path`, `cwd`, `prompt_id`, `permission_mode`, `effort`, `hook_event_name`, `stop_hook_active`, `last_assistant_message`, `background_tasks`, `session` — and carries **no run id, task id or project path**. The run's identity reaches the hook only through the inherited environment.
- A hook inherits the parent environment verbatim, including `BACKLOG_AGENT_ROLE`, `BACKLOG_PROJECT_DIR`, `BACKLOG_RUN_ID` and `BACKLOG_TASK_ID`.
- `stop_hook_active` is `false` on the first call and `true` on the call following a block. It is a boolean, not a counter.
- A trace lives at `<backlogDir>/traces/<task_id>.ndjson`, one line per JSON object, and every line carries `run_id`.
- `packages/cli/src/role-guard.ts` exempts any invocation whose environment has a non-empty `BACKLOG_HOOK_INVOCATION`.
- **End to end:** a `Stop` hook that finds no trace for the run and exits 2 does force a Backlog execution agent to call `mcp__backlog__trace_write`, under the real flag shape. It cost that run 3 extra turns (2 → 5) and about 18.5 s.
- `--bare` disables hooks entirely, so hook-based enforcement and that context-cost optimisation are incompatible.
- `Stop` hook invocations produce **no** `hook_started` / `hook_response` lines in the `--verbose` stream. The only stream-visible evidence of a block is the synthetic user message.

---

### Task 1: The finalizer refuses a run that recorded nothing

The authority. Runtime-agnostic, and testable without `claude` — the fixture uses the `custom` runtime, which is a shell command.

**Files:**
- Modify: `packages/core/src/run-executor.ts` (the success branch, around the `finalizeSuccessfulRun` call)
- Test: `packages/core/src/run-executor.test.ts`

**Interfaces:**
- Consumes: `listTraces(backlogDir: string, taskId: string): Trace[]` from `./trace-store.js`; `failRun(backlogDir: string, runId: string, summary?: string, options?: { cascadeBlock?: boolean }): Promise<void>` from `./run-service.js` (already imported in this file).
- Produces: a run whose `result` string starts with `trace_missing:`. Task 2 and Task 5 refer to that prefix; nothing else depends on this task.

- [x] **Step 1: Write the failing test**

Append to `packages/core/src/run-executor.test.ts`. The existing `fixture(script, overrides?)` helper builds a project with a `custom` agent whose command is the shell script you pass, so `"true"` is an agent that exits 0 having done nothing at all — exactly the case under test.

```ts
  it("fails a run that exited cleanly without recording a trace", async () => {
    const f = fixture("true");

    await executeAgentRun({ ...f, run: f.run });

    const stored = loadRun(f.backlogDir, f.run.id);
    expect(stored?.status).toBe("failed");
    expect(stored?.result ?? "").toContain("trace_missing:");
  });
```

`loadRun` is already imported at the top of this file from `./run-store.js` and is what the neighbouring tests use. Add no accessor.

- [x] **Step 2: Run the test to verify it fails**

Run: `bun test ./packages/core/src/run-executor.test.ts -t "without recording a trace"`
Expected: FAIL. The run finalizes as a success today, so `status` is `succeeded` or `awaiting_review`, never `failed`.

- [x] **Step 3: Add the check to the success branch**

In `packages/core/src/run-executor.ts`, add the import alongside the existing ones:

```ts
import { listTraces } from "./trace-store.js";
```

Then, in `executeAgentRun`, immediately after the `if (!result.ok) { await handleFailure(...); return true; }` block and **before** `const successMode = ...`:

```ts
    // The trace is the only thing about this run that outlives it, and the
    // contract has no state that means "nothing to record": `outcome` is a
    // closed enum, and `blocked` — the agent's only way to ask a human for
    // help — requires an `open_question`. So an absent trace is not an
    // ambiguous signal, it is a run that produced nothing anyone can act on.
    //
    // Checked here rather than in a runtime, because this is the single place
    // every exit-0 run passes: a `custom` run attaches neither an MCP server
    // nor a hook, and is covered by the same three lines.
    const recorded = listTraces(backlogDir, params.workItem.id).some((trace) => trace.run_id === run.id);
    if (!recorded) {
      await failRun(
        backlogDir,
        run.id,
        `trace_missing: agent ${params.agent.id} finished without recording a trace`,
      );
      appendRunEvent(backlogDir, run.id, {
        ts: new Date().toISOString(),
        type: "executor.failed",
        message: "No trace was recorded for this run; see the trace contract in the run prompt.",
      });
      return true;
    }
```

Confirm the local names in scope at that point — the surrounding code already uses `backlogDir`, `run` and `params`. Use whatever those are actually called in the file rather than assuming.

- [x] **Step 4: Run the test to verify it passes**

Run: `bun test ./packages/core/src/run-executor.test.ts`
Expected: PASS, whole file. Other tests in this file run agents that also record no trace, so **expect several of them to start failing** — that is the change working. Fix each by having its fixture script write a trace line, using this shape (one line, `task_001` being whatever task id the fixture uses):

```sh
mkdir -p "$BACKLOG_PROJECT_DIR/traces" && printf '%s\n' "{\"version\":1,\"run_id\":\"$BACKLOG_RUN_ID\",\"task_id\":\"$BACKLOG_TASK_ID\",\"outcome\":\"implemented\",\"summary\":\"fixture\",\"recorded_at\":\"2026-08-18T00:00:00.000Z\"}" >> "$BACKLOG_PROJECT_DIR/traces/$BACKLOG_TASK_ID.ndjson"
```

Read `packages/schemas/src/trace.ts` first and match the schema exactly — `appendTrace` parses every line it reads back, so a line that fails `traceSchema` is skipped and the test will still fail.

- [x] **Step 5: Run the whole core package**

Run: `bun test ./packages/core`
Expected: PASS. Any other test that executes a run to completion needs the same fixture fix.

- [x] **Step 6: Commit**

```bash
git add packages/core/src/run-executor.ts packages/core/src/run-executor.test.ts
git commit -m "feat(core): fail a run that recorded no trace"
```

---

### Task 2: A subcommand the hook can call

The hook needs to ask "does a trace exist for this run" without grepping NDJSON by hand. This subcommand answers by exit code, using the same parser the rest of the system uses.

**Files:**
- Modify: `packages/cli/src/commands/trace.ts`
- Test: `packages/cli/src/commands/trace.test.ts`

**Interfaces:**
- Consumes: `listTraces(backlogDir: string, taskId: string): Trace[]` from `@backlog/core`. Check `packages/core/src/index.ts` exports it; if it does not, add it to that barrel as part of this task.
- Produces: `backlog trace check --project <backlogDir> --run <run-id> --task <task-id>`, exiting **0** when a trace with that `run_id` exists, **1** when it does not, and any other code on an error. Task 3's script depends on exactly those three cases.

- [x] **Step 1: Write the failing test**

Append to `packages/cli/src/commands/trace.test.ts`, following the fixture style already in that file:

```ts
  it("exits 0 when a trace exists for the run and 1 when it does not", async () => {
    const { backlogDir, taskId } = createTraceFixture();

    appendTrace(backlogDir, {
      version: 1,
      run_id: "run_present",
      task_id: taskId,
      outcome: "implemented",
      summary: "did the thing",
      recorded_at: "2026-08-18T00:00:00.000Z",
    });

    await expect(runTraceCheck(backlogDir, "run_present", taskId)).resolves.toBe(0);
    await expect(runTraceCheck(backlogDir, "run_absent", taskId)).resolves.toBe(1);
  });
```

Write `runTraceCheck` as a local helper in the test file that builds the Commander program the same way the neighbouring tests do and captures the exit code — read the existing tests in this file and mirror their mechanism exactly rather than inventing one. Match the trace object to `packages/schemas/src/trace.ts`; if a field name differs, the schema wins.

- [x] **Step 2: Run the test to verify it fails**

Run: `bun test ./packages/cli/src/commands/trace.test.ts -t "exits 0 when a trace exists"`
Expected: FAIL — `error: unknown command 'check'`.

- [x] **Step 3: Add the subcommand**

In `packages/cli/src/commands/trace.ts`, on the existing `trace` command (created at line 84 as `program.command("trace")`), add:

```ts
  trace
    .command("check")
    .description("Exit 0 if this run recorded a trace on this ticket, 1 if it did not")
    .option("--project <path>", "Project to operate on. Defaults to the resolved one.")
    .requiredOption("--run <id>", "Run id to look for")
    .requiredOption("--task <id>", "Ticket the trace belongs to")
    .action((options: { run: string; task: string; project?: string }) => {
      // The generated Stop hook is the caller. It reads nothing from stdout —
      // the exit code is the whole answer — so keep the output for a human
      // debugging the hook by hand.
      const backlogDir = resolveBacklogDir(options.project);
      const recorded = listTraces(backlogDir, options.task).some((trace) => trace.run_id === options.run);
      console.log(recorded ? `trace recorded for ${options.run}` : `no trace for ${options.run}`);
      process.exitCode = recorded ? 0 : 1;
    });
```

`resolveBacklogDir` is already imported in this file and is exactly what `trace write` and `trace show` call — each subcommand declares its own `--project` option and passes `options.project` to it. The code above follows that pattern; do not invent a different one.

- [x] **Step 4: Run the test to verify it passes**

Run: `bun test ./packages/cli/src/commands/trace.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add packages/cli/src/commands/trace.ts packages/cli/src/commands/trace.test.ts
git commit -m "feat(cli): trace check answers whether a run recorded one"
```

---

### Task 3: Generate the Stop hook script

**Files:**
- Create: `packages/hooks/src/stop-hook.ts`
- Modify: `packages/hooks/src/index.ts` (export the new function)
- Test: `packages/hooks/src/stop-hook.test.ts`

**Interfaces:**
- Consumes: Task 2's `backlog trace check --project <dir> --run <id> --task <id>` and its 0/1/other exit codes.
- Produces: `writeStopHook(backlogDir: string): string` — writes the script to `<backlogDir>/bin/stop-hook`, chmods it `0o755`, and returns its absolute path. Task 4 calls it.

- [x] **Step 1: Write the failing test**

Create `packages/hooks/src/stop-hook.test.ts`:

```ts
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
        PATH: "/nonexistent",
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
```

- [x] **Step 2: Run the test to verify it fails**

Run: `bun test ./packages/hooks/src/stop-hook.test.ts`
Expected: FAIL — `Cannot find module './stop-hook.js'`.

- [x] **Step 3: Write the generator**

Create `packages/hooks/src/stop-hook.ts`. Read `packages/config/src/shim.ts` first and mirror its structure — a `renderStopHook()` returning the script text, then a writer. The script resolves the binary through the same order the shim uses, so the hook works from a dev tree and from an installed binary alike.

```ts
import fs from "node:fs";
import path from "node:path";

// Claude Code fires this when a session tries to end. Exiting 2 refuses the
// stop and sends this script's stderr to the model as an instruction, so an
// agent that forgot its trace gets one chance to write it before the run is
// finalized. It never decides the run's status — `run-executor.ts` does that,
// after the process has exited, and it sees cases this hook cannot: a `custom`
// run attaches no hook at all, and `--bare` disables hooks outright.
//
// The hook fails OPEN everywhere except the one case it is sure about. A
// guardrail that hangs an agent is worse than no guardrail, and blocking
// forever is the only failure this script could cause that the finalizer
// would not catch.
function renderStopHook(): string {
  return `#!/usr/bin/env bash
set -uo pipefail

payload=$(cat)

# stop_hook_active is true on the call that follows a block. One block is the
# whole ceiling: it needs no counter and no state on disk, and it makes an
# infinite loop unrepresentable.
if printf '%s' "$payload" | grep -q '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then
  exit 0
fi

# The stdin payload carries no ticket identity — only the environment does.
if [[ -z "\${BACKLOG_RUN_ID:-}" || -z "\${BACKLOG_TASK_ID:-}" || -z "\${BACKLOG_PROJECT_DIR:-}" ]]; then
  exit 0
fi

# This hook is a child of \`claude\`, so it inherits BACKLOG_AGENT_ROLE=execution
# and the CLI would refuse it. BACKLOG_HOOK_INVOCATION is the same exemption the
# generated pre-commit hook uses, and the reason that exemption exists.
export BACKLOG_HOOK_INVOCATION=1

resolve_backlog() {
  if [[ -n "\${BACKLOG_DEV_BIN:-}" && -x "$BACKLOG_DEV_BIN" ]]; then echo "$BACKLOG_DEV_BIN"; return 0; fi
  if command -v backlog >/dev/null 2>&1; then command -v backlog; return 0; fi
  if [[ -x "$HOME/.local/bin/backlog" ]]; then echo "$HOME/.local/bin/backlog"; return 0; fi
  return 1
}

binary=$(resolve_backlog) || exit 0

"$binary" trace check --project "$BACKLOG_PROJECT_DIR" --run "$BACKLOG_RUN_ID" --task "$BACKLOG_TASK_ID" >/dev/null 2>&1
status=$?

# Block only on the one answer we are sure about. Exit 1 means the check ran
# and found nothing; anything else means the check itself failed.
if [[ $status -ne 1 ]]; then
  exit 0
fi

echo "You have not recorded a trace for this run, and it is required. Call the \\\`trace_write\\\` tool now with your outcome and summary, then finish. If you were blocked, that is what \\\`outcome: blocked\\\` with an \\\`open_question\\\` is for." >&2
exit 2
`;
}

export function writeStopHook(backlogDir: string): string {
  const binDir = path.join(backlogDir, "bin");
  fs.mkdirSync(binDir, { recursive: true });
  const hookPath = path.join(binDir, "stop-hook");
  fs.writeFileSync(hookPath, renderStopHook(), "utf8");
  fs.chmodSync(hookPath, 0o755);
  return hookPath;
}
```

Watch the escaping: this is a TypeScript template literal producing shell. `\${VAR}` keeps a shell variable from being interpolated by TypeScript; `$(cat)` and `$status` are safe as written but verify each one by reading the generated file in Step 4.

- [x] **Step 4: Run the tests and read the generated script**

Run: `bun test ./packages/hooks/src/stop-hook.test.ts`
Expected: PASS, all four.

Then read one generated file to confirm the escaping produced the shell you intended:

```bash
bun -e 'import {writeStopHook} from "./packages/hooks/src/stop-hook.ts"; console.log(require("node:fs").readFileSync(writeStopHook(require("node:fs").mkdtempSync("/tmp/hookcheck-")),"utf8"))'
```

- [x] **Step 5: Export it**

Add the export to `packages/hooks/src/index.ts`, matching how the existing hook functions are exported there.

- [x] **Step 6: Commit**

```bash
git add packages/hooks/src/stop-hook.ts packages/hooks/src/stop-hook.test.ts packages/hooks/src/index.ts
git commit -m "feat(hooks): generate a Stop hook that asks for the missing trace"
```

---

### Task 4: Attach the hook to a Claude Code run

**Files:**
- Modify: `packages/core/src/providers/claude-code/command.ts` (the `--settings` emission, around line 107)
- Modify: `packages/core/src/providers/claude-code/provider.ts` (`buildRunCommand`)
- Test: `packages/core/src/providers/claude-code/command.test.ts`
- Test: `packages/core/src/providers/claude-code/provider.test.ts`

**Interfaces:**
- Consumes: Task 3's `writeStopHook(backlogDir: string): string`.
- Produces: nothing later tasks depend on.

- [x] **Step 1: Write the failing tests**

In `packages/core/src/providers/claude-code/command.test.ts`:

```ts
  it("carries a profile and a Stop hook in one --settings payload", () => {
    const command = buildClaudeCodeCommand({
      executable: "claude",
      prompt: "x",
      profile: "work",
      stopHookCommand: "/tmp/project/.backlog/bin/stop-hook",
    });

    const settings = JSON.parse(command.args[command.args.indexOf("--settings") + 1] ?? "{}");
    expect(settings.env).toEqual({ CLAUDE_CODE_PROFILE: "work" });
    expect(settings.hooks).toEqual({
      Stop: [{ hooks: [{ type: "command", command: "/tmp/project/.backlog/bin/stop-hook" }] }],
    });
  });

  it("emits no --settings when there is neither a profile nor a hook", () => {
    const command = buildClaudeCodeCommand({ executable: "claude", prompt: "x" });

    expect(command.args).not.toContain("--settings");
  });
```

In `packages/core/src/providers/claude-code/provider.test.ts`, add one test asserting a run gets a hook. Follow the existing `buildRunCommand` tests in that file for the request shape:

```ts
  it("attaches a Stop hook to every run", () => {
    const command = buildRunCommand({
      agent: agentFixture(),
      prompt: "do the work",
      cwd: "/tmp/worktree",
      backlogDir: "/tmp/project/.backlog",
      env: {},
      getSecret: noSecrets,
      onActivity: () => {},
    });

    const settings = JSON.parse(command.args[command.args.indexOf("--settings") + 1] ?? "{}");
    expect(settings.hooks?.Stop?.[0]?.hooks?.[0]?.command).toContain("stop-hook");
  });
```

- [x] **Step 2: Run both to verify they fail**

Run: `bun test ./packages/core/src/providers/claude-code`
Expected: FAIL — `stopHookCommand` is not a property of `ClaudeCodeCommandInput`, and no run emits `--settings` unless a profile is set.

- [x] **Step 3: Widen the command builder**

In `packages/core/src/providers/claude-code/command.ts`, add to `ClaudeCodeCommandInput`:

```ts
  /** Absolute path to a Stop hook script, attached via --settings. */
  stopHookCommand?: string | undefined;
```

Then replace the profile-gated `--settings` push (currently around line 107) with:

```ts
  // One payload carries both, and it is additive on top of the user's own
  // settings rather than replacing them — verified on claude 2.1.234. The
  // emission is no longer gated on the profile: a run has a hook whether or
  // not it has a profile.
  const settings: Record<string, unknown> = {};
  if (!isBlank(input.profile)) {
    settings["env"] = { CLAUDE_CODE_PROFILE: input.profile.trim() };
  }
  if (!isBlank(input.stopHookCommand)) {
    settings["hooks"] = { Stop: [{ hooks: [{ type: "command", command: input.stopHookCommand.trim() }] }] };
  }
  if (Object.keys(settings).length > 0) {
    args.push("--settings", JSON.stringify(settings));
  }
```

- [x] **Step 4: Attach it in the provider**

In `packages/core/src/providers/claude-code/provider.ts`, import the generator:

```ts
import { writeStopHook } from "@backlog/hooks";
```

and add one property to the `buildClaudeCodeCommand` call inside `buildRunCommand`:

```ts
    // Written per run rather than at install time: the script is identical for
    // every run — it reads the run's identity from the environment — but a
    // project that predates this feature has no bin/stop-hook, and a run is
    // the moment we know we need one.
    stopHookCommand: writeStopHook(request.backlogDir),
```

`packages/core/package.json` does not list `@backlog/hooks` yet — add `"@backlog/hooks": "workspace:*"` beside the four existing workspace dependencies. There is no cycle: `grep -rn "@backlog/core" packages/hooks/src` returns nothing today, and `packages/hooks` must stay that way. If you find yourself needing to import core from hooks, stop and report it rather than working around it.

- [x] **Step 5: Run the provider directory on its own**

Run: `bun test ./packages/core/src/providers`
Expected: PASS. Run this directory alone, not only via the full suite — see Global Constraints.

- [x] **Step 6: Commit**

```bash
git add packages/core/src/providers/claude-code/ packages/core/package.json
git commit -m "feat(core): attach the Stop hook to a Claude Code run"
```

---

### Task 5: Documentation and full verification

**Files:**
- Modify: `CLAUDE.md` §8
- Modify: `docs/superpowers/specs/2026-08-18-traceless-run-design.md:3` (status header)

**Interfaces:**
- Consumes: every earlier task.
- Produces: nothing.

- [x] **Step 1: Correct CLAUDE.md §8**

§8's standing work list carries a bullet beginning *"A `read-only` run's trace is best-effort…"* — or whatever replaced it in #20. Find the bullet about the trace contract and rewrite it to describe the world as it now is: every run reaches `trace_write`, a run that records nothing fails with a `trace_missing:` reason, and a `Stop` hook gives a Claude Code run one chance to fix it in-session. Do **not** write that something "was" best-effort or "used to" fail silently — a reader arriving fresh has no memory of the old design.

Add one line to §8 that the spec's §6 states and that a future reader will need: the miss rate under the current run shape has never been measured, and this change makes it observable for the first time.

While you are there: CLAUDE.md §4 rule 4 cites `packages/cli/src/self-exec.ts`. That file does not exist — it is `packages/core/src/self-exec.ts`, with three consumers. Correct the path.

- [x] **Step 2: Mark the spec implemented**

Change line 3 of `docs/superpowers/specs/2026-08-18-traceless-run-design.md` from `Status: **approved** · not started` to `Status: **approved** · implemented`.

- [x] **Step 3: Run the full verification, in order**

```bash
bun run typecheck
bun run test
bun run build
```

Expected: `typecheck` clean over 322 files; `test` green — the total will be **above** the 781 baseline (this plan adds roughly six tests and deletes none, so expect about 787, and report the number you actually read); `build` produces `dist/backlog` at roughly 63 MB.

Do not report a number you did not read from the output.

- [x] **Step 4: Probe the compiled binary**

```bash
./dist/backlog trace check --help
```

Expected: the subcommand exists and lists `--run` and `--task`.

Then verify the generated hook is what ships, by writing one from the binary's own code path in a scratch project and reading it:

```bash
bun -e 'import {writeStopHook} from "./packages/hooks/src/stop-hook.ts"; const p=writeStopHook(require("node:fs").mkdtempSync("/tmp/hookship-")); console.log(p); console.log(require("node:fs").readFileSync(p,"utf8"))'
```

Expected: a script that greps `stop_hook_active`, exports `BACKLOG_HOOK_INVOCATION`, calls `trace check`, and exits 2 only when that call exits 1.

- [x] **Step 5: Commit**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-08-18-traceless-run-design.md
git commit -m "docs: a run that records nothing has failed"
```

- [x] **Step 6: Tick this plan's checkboxes**

Tick them as tasks land, not at the end.
