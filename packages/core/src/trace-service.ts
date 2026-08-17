import { traceSchema, type Trace } from "@backlog/schemas";
import { blockTask, getSubTask, updateSubTaskStatus } from "./subtask-service.js";
import { createTask, getTask, updateTask, updateTaskStatus } from "./task-service.js";
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

// A discovered dependency is either an edge to a ticket that exists, or work
// that has no ticket yet. The second case creates a task in `proposed` — never
// `ready`, never `backlog` — so nothing an agent invents can schedule itself.
// `backlog` already means "to do"; unvetted work does not belong there.
function applyDiscoveredDeps(
  backlogDir: string,
  trace: Trace,
): { createdProposals: string[]; linkedDeps: string[] } {
  const createdProposals: string[] = [];
  const linkedDeps: string[] = [];

  for (const dep of trace.discovered_deps) {
    if (dep.kind === "existing") {
      if (!getTask(backlogDir, dep.task_id)) {
        throw new Error(`Unknown dependency: ${dep.task_id}`);
      }
      if (dep.task_id === trace.task_id) continue;
      const current = getTask(backlogDir, trace.task_id)!;
      if (!current.dependencies.includes(dep.task_id)) {
        updateTask(backlogDir, trace.task_id, {
          dependencies: [...current.dependencies, dep.task_id],
        });
      }
      if (!linkedDeps.includes(dep.task_id)) linkedDeps.push(dep.task_id);
      continue;
    }

    const scopeNote =
      dep.proposal.scopes.length > 0
        ? `\n\nExpected scope:\n${dep.proposal.scopes.map((s) => `- ${s}`).join("\n")}`
        : "";
    const created = createTask(backlogDir, {
      title: dep.proposal.title,
      description: `${dep.proposal.motive}${scopeNote}`,
      status: "proposed",
    });
    updateTask(backlogDir, created.id, {
      proposal: {
        origin_run_id: trace.run_id,
        origin_task_id: trace.task_id,
        motive: dep.proposal.motive,
        audit: "pending",
      },
    });
    createdProposals.push(created.id);
  }

  return { createdProposals, linkedDeps };
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

  const { createdProposals, linkedDeps } = applyDiscoveredDeps(backlogDir, trace);
  return { trace, transitions, createdProposals, linkedDeps };
}
