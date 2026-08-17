import { traceSchema, type Trace } from "@backlog/schemas";
import { blockTask, getSubTask, updateSubTaskStatus } from "./subtask-service.js";
import { getTask, updateTaskStatus } from "./task-service.js";
import { appendTrace } from "./trace-store.js";

export interface RecordTraceInput {
  backlogDir: string;
  trace: Trace;
}

export interface RecordTraceResult {
  trace: Trace;
  transitions: string[];
  createdProposals: string[];
  linkedDeps: string[];
}

// One outcome produces at most one transition. `implemented` produces none on
// purpose: finalizeSuccessfulRun already derives review-vs-complete from the
// agent's success_mode and manual_approval_required, and a second writer here
// could contradict it — which is the whole reason the trace is the only status
// channel (spec T2).
export function recordTrace(input: RecordTraceInput): RecordTraceResult {
  const { backlogDir } = input;
  const trace = traceSchema.parse(input.trace);

  const task = getTask(backlogDir, trace.task_id);
  if (!task) {
    throw new Error(`Unknown task: ${trace.task_id}`);
  }
  if (trace.subtask_id) {
    const subtask = getSubTask(backlogDir, trace.subtask_id);
    if (!subtask) {
      throw new Error(`Unknown subtask: ${trace.subtask_id}`);
    }
    if (subtask.task_id !== trace.task_id) {
      throw new Error(
        `Subtask ${trace.subtask_id} does not belong to task ${trace.task_id}`,
      );
    }
  }

  appendTrace(backlogDir, trace);

  const transitions: string[] = [];
  if (trace.outcome === "rejected") {
    if (trace.subtask_id) {
      updateSubTaskStatus(backlogDir, trace.subtask_id, "review");
      transitions.push(`${trace.subtask_id} → review`);
    } else {
      updateTaskStatus(backlogDir, trace.task_id, "review");
      transitions.push(`${trace.task_id} → review`);
    }
  } else if (trace.outcome === "blocked") {
    // open_question is guaranteed present by traceSchema for this outcome.
    const question = trace.open_question!;
    if (trace.subtask_id) {
      blockTask(backlogDir, trace.subtask_id, [question]);
      transitions.push(`${trace.subtask_id} → blocked`);
    } else {
      updateTaskStatus(backlogDir, trace.task_id, "blocked");
      transitions.push(`${trace.task_id} → blocked`);
    }
  }

  return { trace, transitions, createdProposals: [], linkedDeps: [] };
}
