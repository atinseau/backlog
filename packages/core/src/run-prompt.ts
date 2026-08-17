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
