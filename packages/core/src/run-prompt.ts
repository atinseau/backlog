import type { Run, Task } from "@backlog/schemas";
import type { ExecutionTarget } from "./execution-target.js";

// The instructions every agent run starts from. Provider-agnostic on purpose:
// what the agent is asked to do should not depend on which runtime executes it.

function section(title: string, items: string[], fallback: string): string[] {
  return [title, ...(items.length > 0 ? items.map((item) => `- ${item}`) : [`- ${fallback}`])];
}

const INSTRUCTIONS = [
  "- inspect the repo state before editing",
  "- treat the task title and description as concrete requirements, not suggestions",
  "- do not mark the task complete just because similarly named files already exist; verify their contents match the requested outcome",
  "- if existing files only partially satisfy the request, update them until the explicit request is fully true",
  "- make the smallest coherent set of changes needed",
  "- run relevant validation if practical",
  "- end with a concise summary of what changed and any follow-up risk",
  "- then record your trace, as described under 'Recording your work' below",
];

// What the agent can see and do beyond editing files. The whole action surface
// below has been shipped for a long time; until this section existed, no agent
// was ever told about any of it (spec §2). It lives here rather than behind
// --append-system-prompt so every runtime gets it: the CLI works everywhere,
// runtime-specific prompt flags do not (spec §9).
const BACKLOG_CONTEXT = [
  "Backlog context:",
  "- Your environment carries BACKLOG_TASK_ID, BACKLOG_SUBTASK_ID, BACKLOG_RUN_ID, BACKLOG_REPO, BACKLOG_BRANCH and BACKLOG_WORKTREE.",
  "- A `backlog` CLI is on your PATH and already resolves this project. You do not need --project.",
  "- `backlog task show <task-id>` — the ticket, its status, its dependencies.",
  "- `backlog subtask show <subtask-id>` — this unit of work.",
  "- `backlog trace show <task-id>` — what earlier runs on this ticket decided, and why. Read it before you start.",
  "- `backlog claim list` — which paths other agents currently hold. Do not edit a path someone else holds.",
];

// The trace is the only channel out of this run: it is what moves the ticket,
// and it is the only thing about this run that outlives it. Stated as its own
// closing section, and referenced from the instruction list above, because a
// contract that gets dropped with the tail of a long list is not a contract.
const TRACE_CONTRACT = [
  "Recording your work (required):",
  "- Before you finish, record a trace. Call the `trace_write` tool if you have it; otherwise pipe the same JSON object into `backlog trace write`.",
  '- The payload is {"outcome": "implemented" | "rejected" | "blocked", "summary": "..."}.',
  "- `rejected` also requires `rejection_reason`. `blocked` also requires `open_question` — that is how you ask a human for help, and it is the only way. There is no channel to another agent.",
  "- Add `constraints` for anything a later run would otherwise rediscover. Each one needs `evidence`: a path:line, a test name, or a command's output. No evidence, no entry.",
  "- Add `decisions` for what you chose, what you rejected, and why. The `why` is the part nobody can reconstruct from the diff.",
  "- Add `discovered_deps` for work this ticket turned out to depend on. An existing task id becomes a dependency edge; anything else becomes a proposal a human reviews.",
  "- Do not try to move the ticket yourself. The trace moves it, and it cannot mark your own work done.",
];

export function buildProviderPrompt(
  task: ExecutionTarget,
  workItem: Task,
  options?: { executionMode?: Run["execution_mode"] },
): string {
  const direct = options?.executionMode === "direct";
  // A run created straight from a task (no split) has no meaningful subtask
  // identity to show — repeating the same title twice only adds noise.
  const isWholeTask = task.target_type === "task" || task.planner.origin === "implicit";

  const lines = [
    direct
      ? "You are executing one Backlog coding task directly in the user's main checkout."
      : "You are executing one Backlog coding task in an isolated git worktree.",
    direct
      ? "Your file edits affect the user's working copy immediately. Stay within the declared scope."
      : "Stay within the declared scope whenever possible.",
    "",
    `Task: ${workItem.id}`,
    `Task title: ${workItem.title}`,
    ...(workItem.description ? [`Task description: ${workItem.description}`] : []),
    ...(isWholeTask ? [] : [`Subtask: ${task.id}`, `Subtask title: ${task.title}`]),
    `Repository: ${task.repo}`,
    `Risk: ${task.risk}`,
    "",
    ...BACKLOG_CONTEXT,
    "",
    ...section("Allowed scopes:", task.scopes, "**"),
    "",
    ...section("Dependencies:", task.depends_on, "none"),
    "",
    ...section(
      "Completion criteria:",
      task.completion.done_when,
      "complete the task safely and summarize what changed",
    ),
    "",
    "Instructions:",
    ...INSTRUCTIONS,
  ];

  if (workItem.acceptance_criteria.length > 0) {
    lines.push("", "Task acceptance criteria:", ...workItem.acceptance_criteria.map((item) => `- ${item}`));
  }

  lines.push("", ...TRACE_CONTRACT);

  return lines.join("\n");
}

/**
 * Wrap the base prompt with the previous attempt's failure context. Without
 * it a retry just repeats the same mistake.
 */
export function buildRetryPrompt(basePrompt: string, attemptNumber: number, previousFeedback: string): string {
  return [
    basePrompt,
    "",
    "---",
    `IMPORTANT: This is retry attempt ${attemptNumber}. The previous attempt`,
    "FAILED. Read the feedback below carefully — do NOT repeat the same",
    "mistake. If the failure looks unrecoverable from your side (rate",
    "limits, missing tooling, environment problems), say so explicitly",
    "in your summary so the human can intervene.",
    "",
    "Previous attempt's failure context:",
    "```",
    previousFeedback.trim(),
    "```",
  ].join("\n");
}
