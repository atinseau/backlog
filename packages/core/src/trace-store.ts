import fs from "node:fs";
import path from "node:path";
import { traceSchema, type Trace } from "@backlog/schemas";

// Traces live outside git, one append-only NDJSON file per task. Append-only is
// load-bearing: a trace is a journal entry, so it is never edited or replaced —
// a retried run adds a line, it does not correct its predecessor.

const warnedUnreadableTraceFiles = new Set<string>();

export function tracesDir(backlogDir: string): string {
  return path.join(backlogDir, "traces");
}

// Task ids are generated internally, but this store is reachable from the CLI
// and the API, so the id is treated as untrusted input before it becomes a path.
function assertSafeTaskId(taskId: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(taskId)) {
    throw new Error(`invalid task id for a trace file: ${taskId}`);
  }
}

export function traceFilePath(backlogDir: string, taskId: string): string {
  assertSafeTaskId(taskId);
  return path.join(tracesDir(backlogDir), `${taskId}.ndjson`);
}

export function appendTrace(backlogDir: string, trace: Trace): string {
  const parsed = traceSchema.parse(trace);
  const filePath = traceFilePath(backlogDir, parsed.task_id);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, JSON.stringify(parsed) + "\n", "utf8");
  return filePath;
}

export function listTraces(backlogDir: string, taskId: string): Trace[] {
  const filePath = traceFilePath(backlogDir, taskId);
  if (!fs.existsSync(filePath)) return [];
  const traces: Trace[] = [];
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      traces.push(traceSchema.parse(JSON.parse(trimmed)));
    } catch (error) {
      // A hand-corrupted line must not make the whole history unreadable.
      if (!warnedUnreadableTraceFiles.has(filePath)) {
        warnedUnreadableTraceFiles.add(filePath);
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`backlog: ignoring unreadable trace in ${filePath}: ${message}`);
      }
    }
  }
  return traces;
}
