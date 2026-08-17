import { completeJsonForProject, completeTextForProject, CompletionUnavailableError } from "@backlog/core";
import type { Task } from "@backlog/schemas";

// Task naming, refinement and split planning. All three are one-shot prompts,
// so they go through the project's completion provider rather than talking to
// any vendor SDK directly — which is what lets them work on a Claude
// subscription, an API key, or whatever runtime is configured next.

export interface ProposedTask {
  title: string;
  repo: string;
  scopes: string[];
  risk: "low" | "medium" | "high";
  depends_on_indices: number[];
}

export interface SplitProposal {
  tasks: ProposedTask[];
  rationale: string;
  model: string;
}

export interface RefinedTaskText {
  title: string;
  description: string;
  model: string;
}

export class AiSplitterUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiSplitterUnavailableError";
  }
}

export interface AiRequestOptions {
  /** Agent ids to prefer, most-preferred first. */
  preferredAgentIds?: string[] | undefined;
  /** Working directory for runtimes that need one. */
  cwd?: string | undefined;
  maxSubagents?: number | undefined;
  /** Extra, user-editable planning instructions appended to the split prompt. */
  plannerPrompt?: string | undefined;
}

const DEFAULT_MAX_SUBAGENTS = 5;
const MAX_TITLE_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 4000;

// ---------------------------------------------------------------- prompts --

const TITLE_SYSTEM_PROMPT = `You generate concise, action-oriented titles for software backlog tasks.

Rules:
- Output ONLY the title, no quotes, no trailing period, nothing else
- Start with an imperative verb in English: "Add", "Fix", "Update", "Remove", "Refactor", "Document", "Migrate", "Wire", "Investigate", "Replace", "Rename", "Disable", "Enable", "Inline", "Extract", "Test"
- Maximum 70 characters
- Be specific about WHAT and WHERE — avoid vague verbs like "Improve", "Handle", "Manage"
- No conjunctions like "and" / "or" — split into multiple tasks would be the answer; here we want one crisp action

Examples:
description: "the user dropdown in the topbar is broken when the avatar is missing"
title: Fix topbar user dropdown when avatar is missing

description: "add a hello.html with a basic h1 and link to the homepage at the repository root"
title: Add hello.html with h1 and homepage link at repository root

description: "configure GitHub Actions to run tests on every push to main"
title: Wire GitHub Actions to run tests on every push to main`;

const REFINE_SYSTEM_PROMPT = `You refine rough backlog ideas into actionable software tasks.

Return ONLY a JSON object with:
- title: a concise imperative software task title, max 70 characters
- description: a polished task description in the same language as the input, 1-4 short paragraphs

Rules:
- Keep the user's intent intact; do not invent scope, deadlines, or technical decisions
- Make unclear wording more concrete and actionable
- If the input is already clear, improve wording lightly
- Do not create sub-tasks or acceptance criteria unless they are already implied`;

const SPLIT_SYSTEM_PROMPT = `You are a software-engineering planner that breaks a backlog task down into concrete sub-tasks designed for parallel execution.

For each task you receive, propose the smallest useful set of sub-tasks up to the provided max_subagents cap. Each sub-task must:
- have a short imperative title (≤ 80 chars)
- target one of the provided repositories (use the exact repository id)
- include 1 to 6 file scopes (paths or globs, repository-relative) that the task will touch
- declare a risk level: 'low' (small, isolated, reversible), 'medium' (touches public APIs or shared modules), 'high' (data migrations, security-sensitive, hard to revert)
- list depends_on_indices: a JSON array of 0-based indices of OTHER tasks in your output that must complete first. Use [] for independent tasks.

Hard rules:
- Tasks with non-overlapping scopes can run in parallel — prefer parallel decomposition when possible
- A task that must read another task's output goes serial via depends_on_indices
- Never propose more sub-tasks than max_subagents; condense or group work evenly when needed
- For repetitive work, group items into balanced chunks. Example: 10 independent files with max_subagents=5 should become 5 sub-tasks with 2 files each
- Scopes should be specific files when known; use globs ('src/foo/**') only when many files are touched
- Risk reflects blast radius, not difficulty: a tedious-but-safe task is 'low'

Also include a one-paragraph 'rationale' (≤ 200 chars) explaining the parallel/serial structure of your proposal.`;

const REFINE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    description: { type: "string" },
  },
  required: ["title", "description"],
  additionalProperties: false,
} as const;

const PROPOSAL_SCHEMA = {
  type: "object",
  properties: {
    tasks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          repo: { type: "string" },
          scopes: { type: "array", items: { type: "string" }, minItems: 1 },
          risk: { type: "string", enum: ["low", "medium", "high"] },
          depends_on_indices: { type: "array", items: { type: "integer", minimum: 0 } },
        },
        required: ["title", "repo", "scopes", "risk", "depends_on_indices"],
        additionalProperties: false,
      },
    },
    rationale: { type: "string" },
  },
  required: ["tasks", "rationale"],
  additionalProperties: false,
} as const;

function clampMaxSubagents(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_MAX_SUBAGENTS;
  return Math.max(1, Math.min(99, Math.round(value)));
}

function buildSplitSystemPrompt(customPrompt: string | undefined): string {
  const custom = customPrompt?.trim();
  if (!custom) return SPLIT_SYSTEM_PROMPT;
  return `${SPLIT_SYSTEM_PROMPT}\n\nAdditional user-editable planning instructions:\n${custom}`;
}

function buildSplitPrompt(task: Task, repositories: string[], maxSubagents: number): string {
  const lines = [
    `Task id: ${task.id}`,
    `Title: ${task.title}`,
    `Priority: ${task.priority}`,
    ...(task.description ? [`Description: ${task.description}`] : []),
    ...(task.acceptance_criteria.length > 0
      ? ["Acceptance criteria:", ...task.acceptance_criteria.map((item) => `- ${item}`)]
      : []),
    ...(task.labels.length > 0 ? [`Labels: ${task.labels.join(", ")}`] : []),
    `Risk hint: ${task.planning.risk}`,
    "",
    `Available repositories for this project: ${repositories.join(", ")}`,
    `max_subagents: ${maxSubagents}`,
    ...(task.repo_targets.length > 0
      ? [`Preferred repository targets on this task: ${task.repo_targets.join(", ")}`]
      : []),
    "",
    "Propose up to max_subagents sub-tasks following the schema. Maximize safe parallelism and keep independent chunks dependency-free.",
  ];
  return lines.join("\n");
}

function buildRefinePrompt(task: Task): string {
  const lines = [
    `Task id: ${task.id}`,
    `Current title: ${task.title}`,
    ...(task.description ? [`Current description: ${task.description}`] : []),
    ...(task.labels.length > 0 ? [`Labels: ${task.labels.join(", ")}`] : []),
    ...(task.repo_targets.length > 0 ? [`Target repositories: ${task.repo_targets.join(", ")}`] : []),
    "",
    "Refine this backlog idea into a clearer task, preserving the language and intent.",
  ];
  return lines.join("\n");
}

// ------------------------------------------------------------- validation --

export function cleanupTitle(raw: string): string {
  // Models sometimes wrap the title or end it with a period despite the
  // instruction; the length cap guards against unexpected verbosity.
  let out = raw.trim();
  if ((out.startsWith('"') && out.endsWith('"')) || (out.startsWith("«") && out.endsWith("»"))) {
    out = out.slice(1, -1).trim();
  }
  if (out.endsWith(".")) out = out.slice(0, -1).trim();
  return out.length > MAX_TITLE_LENGTH ? `${out.slice(0, MAX_TITLE_LENGTH - 3).trimEnd()}…` : out;
}

/** Last resort when no AI runtime is configured: the first sentence, capitalised. */
export function fallbackTitle(description: string): string {
  const trimmed = description.trim();
  if (!trimmed) return "New task";
  const firstSentence = trimmed.split(/[.\n!?]/)[0]!.trim();
  const capitalised = firstSentence.charAt(0).toUpperCase() + firstSentence.slice(1);
  return capitalised.length > 70 ? `${capitalised.slice(0, 67).trimEnd()}…` : capitalised;
}

function validateRefinedText(parsed: unknown, model: string): RefinedTaskText {
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Refinement is not an object.");
  }
  const obj = parsed as Record<string, unknown>;
  const title = cleanupTitle(String(obj.title ?? ""));
  const description = String(obj.description ?? "").trim();
  if (!title) throw new Error("Refinement did not include a title.");
  if (!description) throw new Error("Refinement did not include a description.");
  return {
    title,
    description:
      description.length > MAX_DESCRIPTION_LENGTH
        ? `${description.slice(0, MAX_DESCRIPTION_LENGTH - 3).trimEnd()}...`
        : description,
    model,
  };
}

export function validateProposal(
  parsed: unknown,
  repositories: string[],
  model: string,
  maxSubagents: number,
): SplitProposal {
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Proposal is not an object");
  }
  const obj = parsed as Record<string, unknown>;
  const max = clampMaxSubagents(maxSubagents);
  if (!Array.isArray(obj.tasks) || obj.tasks.length < 1 || obj.tasks.length > max) {
    throw new Error(`Proposal must contain 1 to ${max} tasks`);
  }

  const tasks: ProposedTask[] = obj.tasks.map((raw, index) => {
    if (!raw || typeof raw !== "object") throw new Error(`tasks[${index}] is not an object`);
    const t = raw as Record<string, unknown>;
    const title = String(t.title ?? "").trim();
    const repo = String(t.repo ?? "").trim();
    const risk = t.risk;
    const scopes = Array.isArray(t.scopes) ? t.scopes.map(String).filter((s) => s.length > 0) : [];
    const depends = Array.isArray(t.depends_on_indices)
      ? t.depends_on_indices.map(Number).filter((n) => Number.isInteger(n) && n >= 0)
      : [];

    if (!title) throw new Error(`tasks[${index}].title is required`);
    if (!repo) throw new Error(`tasks[${index}].repo is required`);
    if (!repositories.includes(repo)) {
      throw new Error(
        `tasks[${index}].repo='${repo}' is not in the project repositories [${repositories.join(", ")}]`,
      );
    }
    if (risk !== "low" && risk !== "medium" && risk !== "high") {
      throw new Error(`tasks[${index}].risk must be 'low' | 'medium' | 'high'`);
    }
    if (scopes.length === 0) throw new Error(`tasks[${index}].scopes must not be empty`);
    return { title, repo, scopes, risk, depends_on_indices: depends };
  });

  for (let i = 0; i < tasks.length; i++) {
    for (const dep of tasks[i]!.depends_on_indices) {
      if (dep === i) throw new Error(`tasks[${i}] cannot depend on itself`);
      if (dep >= tasks.length) {
        throw new Error(`tasks[${i}].depends_on_indices contains out-of-range index ${dep}`);
      }
    }
  }

  return { tasks, rationale: String(obj.rationale ?? "").slice(0, 1000), model };
}

// ----------------------------------------------------------------- public --

/** Translate "nothing is configured" into the error shape the routes answer 503 on. */
function rethrowUnavailable(error: unknown): never {
  if (error instanceof CompletionUnavailableError) {
    throw new AiSplitterUnavailableError(error.message);
  }
  throw error;
}

export async function suggestTitle(
  backlogDir: string,
  description: string,
  options: AiRequestOptions = {},
): Promise<{ title: string; model: string }> {
  const text = description.trim();
  if (!text) {
    throw new Error("Description is empty — cannot suggest a title.");
  }
  try {
    const completion = await completeTextForProject(backlogDir, {
      prompt: `Description: ${text}`,
      systemPrompt: TITLE_SYSTEM_PROMPT,
      preferredAgentIds: options.preferredAgentIds,
      cwd: options.cwd,
    });
    return { title: cleanupTitle(completion.text), model: completion.model };
  } catch (error) {
    return rethrowUnavailable(error);
  }
}

export async function refineTaskText(
  backlogDir: string,
  task: Task,
  options: AiRequestOptions = {},
): Promise<RefinedTaskText> {
  try {
    const result = await completeJsonForProject(backlogDir, {
      prompt: buildRefinePrompt(task),
      systemPrompt: REFINE_SYSTEM_PROMPT,
      schema: REFINE_SCHEMA as unknown as Record<string, unknown>,
      schemaName: "refined_task",
      preferredAgentIds: options.preferredAgentIds,
      cwd: options.cwd,
    });
    return validateRefinedText(result.value, result.model);
  } catch (error) {
    return rethrowUnavailable(error);
  }
}

export async function suggestSplit(
  backlogDir: string,
  task: Task,
  repositories: string[],
  options: AiRequestOptions = {},
): Promise<SplitProposal> {
  if (repositories.length === 0) {
    throw new Error(
      "No repositories available — configure at least one repository in the project before splitting.",
    );
  }
  const maxSubagents = clampMaxSubagents(options.maxSubagents);
  try {
    const result = await completeJsonForProject(backlogDir, {
      prompt: buildSplitPrompt(task, repositories, maxSubagents),
      systemPrompt: buildSplitSystemPrompt(options.plannerPrompt),
      schema: PROPOSAL_SCHEMA as unknown as Record<string, unknown>,
      schemaName: "split_proposal",
      preferredAgentIds: options.preferredAgentIds,
      cwd: options.cwd,
    });
    return validateProposal(result.value, repositories, result.model, maxSubagents);
  } catch (error) {
    return rethrowUnavailable(error);
  }
}
