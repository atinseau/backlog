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
