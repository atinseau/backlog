import { traceSchema, type SubTask, type Task, type Trace } from "@backlog/schemas";
import { blockTask, getSubTask, updateSubTaskStatus } from "./subtask-service.js";
import { createTask, getTask, updateTask, updateTaskStatus } from "./task-service.js";
import { appendTrace } from "./trace-store.js";

export interface RecordTraceInput {
  backlogDir: string;
  // Unparsed on purpose: recordTrace runs the payload through `traceSchema`, so
  // callers hand over raw input (a JSON object from stdin, an API body) instead
  // of casting it to a `Trace` they have not validated.
  trace: unknown;
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
      // Unreachable: validateDiscoveredDeps already resolved every existing dep
      // before anything was persisted. Kept as a guard, not as the check.
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

// Every `kind: "existing"` dependency is resolved here, up front, rather than
// lazily inside applyDiscoveredDeps' loop. See the atomicity note in
// recordTrace: a dep that fails to resolve halfway through would leave a
// journal line, a status transition and some of the deps already written.
function validateDiscoveredDeps(backlogDir: string, trace: Trace): void {
  for (const dep of trace.discovered_deps) {
    if (dep.kind === "existing" && !getTask(backlogDir, dep.task_id)) {
      throw new Error(`Unknown dependency: ${dep.task_id}`);
    }
  }
}

// A trace is always journalled — the store is append-only, and losing an agent's
// journal entry is worse than not moving a ticket — but it may not move every
// ticket it names. Two cases refuse, and say so in the result's `transitions` so
// the agent reads the refusal instead of inferring success:
//
//   - `proposed`: unaudited, agent-invented work. It leaves only by human review,
//     and only for `backlog` (spec §7). updateTaskStatus enforces that for the
//     task itself; refusing here also covers the subtask side, whose status
//     cascade would otherwise flip the parent, and names the reason.
//   - terminal: a `done` / `released` task, or a `completed` subtask. A `rejected`
//     trace would otherwise send finished work back to `review`, letting one run
//     silently un-finish what another legitimately completed. A human may reopen
//     such a ticket; an agent may not.
function transitionRefusal(task: Task, subtask: SubTask | null): string | null {
  if (task.status === "proposed") {
    return `${task.id}: no transition (proposed, awaiting human review)`;
  }
  if (task.status === "done" || task.status === "released") {
    return `${task.id}: no transition (${task.status} is terminal)`;
  }
  if (subtask?.status === "completed") {
    return `${subtask.id}: no transition (completed is terminal)`;
  }
  return null;
}

// One outcome produces at most one transition. `implemented` produces none on
// purpose: finalizeSuccessfulRun already derives review-vs-complete from the
// agent's success_mode and manual_approval_required, and a second writer here
// could contradict it — which is the whole reason the trace is the only status
// channel (spec T2).
//
// "Validate everything, then persist" is a property of this function, not an
// accident of statement order, and it is worth spelling out here because this is
// the one place in the trace path where atomicity matters. The store is
// append-only: a throw after `appendTrace` leaves a journal line no one can
// retract, and the agent that sees the throw concludes nothing was recorded and
// retries — duplicating the trace, its transition and its proposals for good. So
// every check that can fail runs before `appendTrace`, and the only failure mode
// left after it is I/O.
export function recordTrace(input: RecordTraceInput): RecordTraceResult {
  const { backlogDir } = input;
  const trace = traceSchema.parse(input.trace);

  const task = getTask(backlogDir, trace.task_id);
  if (!task) {
    throw new Error(`Unknown task: ${trace.task_id}`);
  }
  let subtask: SubTask | null = null;
  if (trace.subtask_id) {
    subtask = getSubTask(backlogDir, trace.subtask_id);
    if (!subtask) {
      throw new Error(`Unknown subtask: ${trace.subtask_id}`);
    }
    if (subtask.task_id !== trace.task_id) {
      throw new Error(
        `Subtask ${trace.subtask_id} does not belong to task ${trace.task_id}`,
      );
    }
  }
  validateDiscoveredDeps(backlogDir, trace);

  appendTrace(backlogDir, trace);

  const transitions: string[] = [];
  // Only outcomes that would move something can be refused; `implemented` never
  // transitions, so it must not report a refusal it never ran into.
  const wantsTransition = trace.outcome === "rejected" || trace.outcome === "blocked";
  const refusal = wantsTransition ? transitionRefusal(task, subtask) : null;
  if (refusal) {
    transitions.push(refusal);
  } else if (trace.outcome === "rejected") {
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
