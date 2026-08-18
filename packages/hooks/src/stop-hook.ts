import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * The command that re-runs this CLI, as `selfExec()` in
 * `packages/core/src/self-exec.ts` reports it: an executable plus the leading
 * arguments it needs before a subcommand (empty in the compiled binary, the Bun
 * entrypoint in a dev tree).
 */
export interface StopHookBinary {
  command: string;
  prefixArgs: readonly string[];
}

/** Single-quote a value for bash, closing and reopening around any quote of its own. */
function shellQuote(value: string): string {
  return `'${value.split("'").join(`'\\''`)}'`;
}

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
function renderStopHook(binary: StopHookBinary): string {
  const command = shellQuote(binary.command);
  const prefixArgs = binary.prefixArgs.map(shellQuote).join(" ");
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

# The exact binary that launched this run, baked in by the call site that
# already knew it. Searching for one instead would be a guess, and the one guess
# that goes wrong is a \`backlog\` on PATH predating \`trace check\`: it exits 1 on
# the unknown subcommand, which this hook reads as "trace genuinely missing" and
# blocks on.
backlog_command=${command}
backlog_prefix_args=(${prefixArgs})

# Fail open if that binary is gone — moved, uninstalled, or a dev tree rebuilt
# somewhere else. \`command -v\` covers a bare name resolved through PATH.
if [[ ! -x "$backlog_command" ]] && ! command -v "$backlog_command" >/dev/null 2>&1; then
  exit 0
fi

# bash 3.2 (still the macOS system bash) treats an empty array as unset under
# \`set -u\`, so the expansion has to be guarded rather than written plainly.
"$backlog_command" \${backlog_prefix_args[@]+"\${backlog_prefix_args[@]}"} trace check --project "$BACKLOG_PROJECT_DIR" --run "$BACKLOG_RUN_ID" --task "$BACKLOG_TASK_ID" >/dev/null 2>&1
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

/**
 * Write the Stop hook script and return its path.
 *
 * The write goes through a sibling temp file and a rename, because a run
 * writes this while another run's `claude` may be executing it — `max_agents`
 * above 1 is the point of the orchestrator. A rename is atomic, so a concurrent
 * reader sees one whole script or the other; truncating in place would let it
 * read a half-written file, and a bash syntax error exits 2, the one code that
 * blocks a stop.
 */
export function writeStopHook(backlogDir: string, binary: StopHookBinary): string {
  const binDir = path.join(backlogDir, "bin");
  fs.mkdirSync(binDir, { recursive: true });
  const hookPath = path.join(binDir, "stop-hook");
  const stagingPath = `${hookPath}.${randomUUID()}.tmp`;
  fs.writeFileSync(stagingPath, renderStopHook(binary), "utf8");
  fs.chmodSync(stagingPath, 0o755);
  fs.renameSync(stagingPath, hookPath);
  return hookPath;
}
