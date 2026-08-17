import { Command } from "commander";
import { findProject } from "@backlog/config";
import { listTraces, recordTrace, type RecordTraceResult } from "@backlog/core";

// The agent-facing write surface. JSON arrives on stdin rather than in argv: a
// nested payload in a command line is error-prone, and argv shows up in `ps`.

export async function readTraceFromStdin(
  stream: ReadableStream<Uint8Array>,
): Promise<Record<string, unknown>> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  if (!text.trim()) {
    throw new Error("No trace payload on stdin. Pipe a JSON object into `backlog trace write`.");
  }
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("The trace payload must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

// An agent already has BACKLOG_RUN_ID / BACKLOG_TASK_ID / BACKLOG_SUBTASK_ID in
// its environment, so the payload may omit them. Anything the payload states
// wins, so a caller can still write a trace for another context deliberately.
function withContextDefaults(payload: Record<string, unknown>): Record<string, unknown> {
  const filled: Record<string, unknown> = { version: 1, ...payload };
  if (filled.run_id === undefined && process.env.BACKLOG_RUN_ID) {
    filled.run_id = process.env.BACKLOG_RUN_ID;
  }
  if (filled.task_id === undefined && process.env.BACKLOG_TASK_ID) {
    filled.task_id = process.env.BACKLOG_TASK_ID;
  }
  if (filled.subtask_id === undefined && process.env.BACKLOG_SUBTASK_ID) {
    filled.subtask_id = process.env.BACKLOG_SUBTASK_ID;
  }
  if (filled.created_at === undefined) {
    filled.created_at = new Date().toISOString();
  }
  return filled;
}

export function runTraceWrite(
  backlogDir: string,
  payload: Record<string, unknown>,
): RecordTraceResult {
  const filled = withContextDefaults(payload);
  // recordTrace re-parses through traceSchema, so an invalid payload throws
  // before anything is persisted.
  return recordTrace({ backlogDir, trace: filled as never });
}

export function runTraceShow(backlogDir: string, taskId: string): string[] {
  const traces = listTraces(backlogDir, taskId);
  if (traces.length === 0) {
    return [`No trace recorded for ${taskId}.`];
  }
  const lines: string[] = [];
  for (const trace of traces) {
    lines.push(`${trace.created_at}  ${trace.run_id}  ${trace.outcome}`);
    lines.push(`  ${trace.summary}`);
    if (trace.rejection_reason) lines.push(`  rejected because: ${trace.rejection_reason}`);
    if (trace.open_question) lines.push(`  open question: ${trace.open_question}`);
    for (const constraint of trace.constraints) {
      lines.push(`  constraint (${constraint.confidence}): ${constraint.statement}`);
      lines.push(`    evidence: ${constraint.evidence}`);
    }
    for (const decision of trace.decisions) {
      lines.push(`  chose ${decision.chose} over ${decision.rejected}: ${decision.because}`);
    }
    lines.push("");
  }
  return lines;
}

function resolveBacklogDir(projectOption?: string): string {
  const project = findProject(projectOption ?? process.cwd());
  if (!project) {
    throw new Error("No .backlog project found. Pass --project or run from inside one.");
  }
  return project.backlogDir;
}

export function registerTraceCommand(program: Command): void {
  const trace = program.command("trace").description("Record and read agent traces on a ticket");

  trace
    .command("write")
    .description("Write a trace from a JSON object on stdin")
    .option("--project <path>", "Project to operate on. Defaults to the resolved one.")
    .action(async (options: { project?: string }) => {
      const backlogDir = resolveBacklogDir(options.project);
      const payload = await readTraceFromStdin(Bun.stdin.stream());
      const result = runTraceWrite(backlogDir, payload);
      console.log(`Trace recorded for ${result.trace.task_id} (${result.trace.outcome}).`);
      for (const transition of result.transitions) console.log(`  ${transition}`);
      for (const id of result.linkedDeps) console.log(`  linked dependency ${id}`);
      for (const id of result.createdProposals) console.log(`  proposed ${id}`);
    });

  trace
    .command("show <taskId>")
    .description("Show every trace recorded on a task, oldest first")
    .option("--project <path>", "Project to operate on. Defaults to the resolved one.")
    .action((taskId: string, options: { project?: string }) => {
      for (const line of runTraceShow(resolveBacklogDir(options.project), taskId)) {
        console.log(line);
      }
    });
}
