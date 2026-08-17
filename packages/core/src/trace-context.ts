// A trace payload's context fields — who wrote it, about what, when. An agent
// already has these in its environment (run-executor.ts sets them), so the
// payload it writes may omit them. Lives in core rather than in the CLI command
// because two channels fill them now: `backlog trace write` and the MCP
// `trace_write` tool. One copy, so they cannot drift.
//
// Anything the payload states wins, so a caller can still write a trace for
// another context deliberately.
export function withTraceContextDefaults(
  payload: Record<string, unknown>,
  env: NodeJS.ProcessEnv,
): Record<string, unknown> {
  const filled: Record<string, unknown> = { ...payload };
  if (filled.version === undefined) {
    filled.version = 1;
  }
  if (filled.run_id === undefined && env.BACKLOG_RUN_ID) {
    filled.run_id = env.BACKLOG_RUN_ID;
  }
  if (filled.task_id === undefined && env.BACKLOG_TASK_ID) {
    filled.task_id = env.BACKLOG_TASK_ID;
  }
  if (filled.subtask_id === undefined && env.BACKLOG_SUBTASK_ID) {
    filled.subtask_id = env.BACKLOG_SUBTASK_ID;
  }
  if (filled.created_at === undefined) {
    filled.created_at = new Date().toISOString();
  }
  return filled;
}
