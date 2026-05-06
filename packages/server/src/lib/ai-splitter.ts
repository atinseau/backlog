import Anthropic from "@anthropic-ai/sdk";
import type { Task } from "@backlog/schemas";

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

export type AiProvider = "anthropic" | "openai" | "codex";

export class AiSplitterUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiSplitterUnavailableError";
  }
}

const SYSTEM_PROMPT = `You are a software-engineering planner that breaks a backlog task down into a small set of concrete sub-tasks.

For each task you receive, propose between 2 and 6 sub-tasks. Each task must:
- have a short imperative title (≤ 80 chars)
- target one of the provided repositories (use the exact repository id)
- include 1 to 6 file scopes (paths or globs, repository-relative) that the task will touch
- declare a risk level: 'low' (small, isolated, reversible), 'medium' (touches public APIs or shared modules), 'high' (data migrations, security-sensitive, hard to revert)
- list depends_on_indices: a JSON array of 0-based indices of OTHER tasks in your output that must complete first. Use [] for independent tasks.

Hard rules:
- Tasks with non-overlapping scopes can run in parallel — prefer parallel decomposition when possible
- A task that must read another task's output goes serial via depends_on_indices
- Never propose more than 6 tasks; condense if needed
- Scopes should be specific files when known; use globs ('src/foo/**') only when many files are touched
- Risk reflects blast radius, not difficulty: a tedious-but-safe task is 'low'

Also include a one-paragraph 'rationale' (≤ 200 chars) explaining the parallel/serial structure of your proposal.`;

const PROPOSAL_SCHEMA = {
  type: "object",
  properties: {
    tasks: {
      type: "array",
      minItems: 2,
      maxItems: 6,
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          repo: { type: "string" },
          scopes: {
            type: "array",
            items: { type: "string" },
            minItems: 1,
          },
          risk: { type: "string", enum: ["low", "medium", "high"] },
          depends_on_indices: {
            type: "array",
            items: { type: "integer", minimum: 0 },
          },
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

const REFINE_SYSTEM_PROMPT = `You refine rough backlog ideas into actionable software tasks.

Return ONLY a JSON object with:
- title: a concise imperative software task title, max 70 characters
- description: a polished task description in the same language as the input, 1-4 short paragraphs

Rules:
- Keep the user's intent intact; do not invent scope, deadlines, or technical decisions
- Make unclear wording more concrete and actionable
- If the input is already clear, improve wording lightly
- Do not create sub-tasks or acceptance criteria unless they are already implied`;

const REFINE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    description: { type: "string" },
  },
  required: ["title", "description"],
  additionalProperties: false,
} as const;

function buildUserPrompt(task: Task, repositories: string[]): string {
  const lines: string[] = [];
  lines.push(`Task id: ${task.id}`);
  lines.push(`Title: ${task.title}`);
  lines.push(`Priority: ${task.priority}`);
  if (task.description) lines.push(`Description: ${task.description}`);
  if (task.acceptance_criteria.length > 0) {
    lines.push("Acceptance criteria:");
    for (const ac of task.acceptance_criteria) lines.push(`- ${ac}`);
  }
  if (task.labels.length > 0) lines.push(`Labels: ${task.labels.join(", ")}`);
  lines.push(`Risk hint: ${task.planning.risk}`);
  lines.push("");
  lines.push(`Available repositories for this project: ${repositories.join(", ")}`);
  if (task.repo_targets.length > 0) {
    lines.push(`Preferred repository targets on this task: ${task.repo_targets.join(", ")}`);
  }
  lines.push("");
  lines.push("Propose 2 to 6 sub-tasks following the schema. Maximize parallelism where scopes don't overlap.");
  return lines.join("\n");
}

function buildRefinePrompt(task: Task): string {
  const lines: string[] = [];
  lines.push(`Task id: ${task.id}`);
  lines.push(`Current title: ${task.title}`);
  if (task.description) lines.push(`Current description: ${task.description}`);
  if (task.labels.length > 0) lines.push(`Labels: ${task.labels.join(", ")}`);
  if (task.repo_targets.length > 0) lines.push(`Target repositories: ${task.repo_targets.join(", ")}`);
  lines.push("");
  lines.push("Refine this backlog idea into a clearer task, preserving the language and intent.");
  return lines.join("\n");
}

interface SuggestOptions {
  provider?: AiProvider;
  apiKey?: string;
  model?: string;
}

// ---- Title suggestion ----------------------------------------------------
//
// Given a free-form description, ask the LLM for a short imperative-mood
// title. The user types only the description in CreateTaskDialog; the
// title is generated server-side at task creation. Falls back to a
// trimmed first sentence of the description when the AI provider is
// unavailable so task creation never blocks on credentials.

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

export async function suggestTitle(
  description: string,
  options: SuggestOptions = {},
): Promise<{ title: string; model: string }> {
  const text = description.trim();
  if (!text) {
    throw new Error("Description is empty — cannot suggest a title.");
  }
  const provider = options.provider ?? (process.env.BACKLOG_AI_PROVIDER as AiProvider) ?? "anthropic";
  if (provider === "anthropic") return suggestTitleAnthropic(text, options);
  if (provider === "openai" || provider === "codex") return suggestTitleOpenAi(text, options);
  throw new AiSplitterUnavailableError(`Unknown AI provider: ${provider}`);
}

async function suggestTitleAnthropic(
  description: string,
  options: SuggestOptions,
): Promise<{ title: string; model: string }> {
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new AiSplitterUnavailableError("ANTHROPIC_API_KEY is not set.");
  }
  const client = new Anthropic({ apiKey });
  // Haiku is plenty for a 70-char generation — fast, cheap, no
  // thinking budget needed. The user types a description and the
  // title pops back in under a second.
  const model = options.model ?? "claude-haiku-4-5";
  const response = await client.messages.create({
    model,
    max_tokens: 60,
    system: TITLE_SYSTEM_PROMPT,
    messages: [{ role: "user", content: `Description: ${description}` }],
  });
  const textBlock = response.content.find(
    (block): block is Anthropic.TextBlock => block.type === "text",
  );
  if (!textBlock) {
    throw new Error("Anthropic response had no text block.");
  }
  return { title: cleanupTitle(textBlock.text), model };
}

async function suggestTitleOpenAi(
  description: string,
  options: SuggestOptions & { isCodex?: boolean } = {},
): Promise<{ title: string; model: string }> {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new AiSplitterUnavailableError("OPENAI_API_KEY is not set.");
  }
  const model = options.model ?? "gpt-5-mini";
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 60,
      messages: [
        { role: "system", content: TITLE_SYSTEM_PROMPT },
        { role: "user", content: `Description: ${description}` },
      ],
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`OpenAI title call failed (${response.status}): ${detail}`);
  }
  const json = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = json.choices?.[0]?.message?.content ?? "";
  if (!text.trim()) {
    throw new Error("OpenAI returned an empty title.");
  }
  return { title: cleanupTitle(text), model };
}

function cleanupTitle(raw: string): string {
  // Strip surrounding quotes / trailing period the model sometimes
  // adds despite the system prompt. Cap at 80 chars as a hard
  // safeguard against unexpected verbosity.
  let out = raw.trim();
  if ((out.startsWith('"') && out.endsWith('"')) || (out.startsWith("«") && out.endsWith("»"))) {
    out = out.slice(1, -1).trim();
  }
  if (out.endsWith(".")) out = out.slice(0, -1).trim();
  if (out.length > 80) out = out.slice(0, 77).trimEnd() + "…";
  return out;
}

// Last-resort title when the AI provider is unavailable or fails.
// Takes the first sentence of the description, capitalises it, caps
// it at 70 chars. Not as good as the LLM output but never empty.
export function fallbackTitle(description: string): string {
  const trimmed = description.trim();
  if (!trimmed) return "New task";
  const firstSentence = trimmed.split(/[.\n!?]/)[0]!.trim();
  const capitalised = firstSentence.charAt(0).toUpperCase() + firstSentence.slice(1);
  return capitalised.length > 70 ? capitalised.slice(0, 67).trimEnd() + "…" : capitalised;
}

export async function refineTaskText(
  task: Task,
  options: SuggestOptions = {},
): Promise<RefinedTaskText> {
  const provider = options.provider ?? (process.env.BACKLOG_AI_PROVIDER as AiProvider) ?? "anthropic";
  if (provider === "anthropic") return refineTaskTextAnthropic(task, options);
  if (provider === "openai" || provider === "codex") return refineTaskTextOpenAi(task, { ...options, isCodex: provider === "codex" });
  throw new AiSplitterUnavailableError(`Unknown AI provider: ${provider}`);
}

async function refineTaskTextAnthropic(
  task: Task,
  options: SuggestOptions,
): Promise<RefinedTaskText> {
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new AiSplitterUnavailableError("ANTHROPIC_API_KEY is not set.");
  }
  const client = new Anthropic({ apiKey });
  const model = options.model ?? "claude-haiku-4-5";
  const response = await client.messages.create({
    model,
    max_tokens: 900,
    system: REFINE_SYSTEM_PROMPT,
    output_config: {
      format: {
        type: "json_schema",
        schema: REFINE_SCHEMA as unknown as Record<string, unknown>,
      },
    },
    messages: [{ role: "user", content: buildRefinePrompt(task) }],
  });
  const textBlock = response.content.find(
    (block): block is Anthropic.TextBlock => block.type === "text",
  );
  if (!textBlock) {
    throw new Error("Anthropic response had no text block.");
  }
  return validateRefinedText(parseJsonObject(textBlock.text, "Anthropic"), model);
}

async function refineTaskTextOpenAi(
  task: Task,
  options: SuggestOptions & { isCodex?: boolean },
): Promise<RefinedTaskText> {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new AiSplitterUnavailableError("OPENAI_API_KEY is not set.");
  }
  const model = options.model ?? (options.isCodex ? "gpt-5-codex" : "gpt-5-mini");
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: REFINE_SYSTEM_PROMPT },
        { role: "user", content: buildRefinePrompt(task) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "refined_task",
          strict: true,
          schema: REFINE_SCHEMA,
        },
      },
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`OpenAI returned ${response.status}: ${detail.slice(0, 500)}`);
  }
  const json = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const text = json.choices?.[0]?.message?.content ?? "";
  if (!text.trim()) throw new Error("OpenAI returned an empty refinement.");
  return validateRefinedText(parseJsonObject(text, "OpenAI"), model);
}

function parseJsonObject(text: string, provider: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(
      `${provider} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}\nRaw text: ${text.slice(0, 500)}`,
    );
  }
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
    description: description.length > 4000 ? `${description.slice(0, 3997).trimEnd()}...` : description,
    model,
  };
}

export async function suggestSplit(
  task: Task,
  repositories: string[],
  options: SuggestOptions = {},
): Promise<SplitProposal> {
  if (repositories.length === 0) {
    throw new Error("No repositories available — configure at least one repository in the project before splitting.");
  }
  const provider = options.provider ?? (process.env.BACKLOG_AI_PROVIDER as AiProvider) ?? "anthropic";
  if (provider === "anthropic") return suggestSplitAnthropic(task, repositories, options);
  if (provider === "openai" || provider === "codex") {
    return suggestSplitOpenAi(task, repositories, { ...options, isCodex: provider === "codex" });
  }
  throw new AiSplitterUnavailableError(`Unknown AI provider: ${provider}`);
}

async function suggestSplitAnthropic(
  task: Task,
  repositories: string[],
  options: SuggestOptions,
): Promise<SplitProposal> {
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new AiSplitterUnavailableError(
      "ANTHROPIC_API_KEY is not set. Export the variable or switch the AI provider in .backlog/config.toml.",
    );
  }
  const client = new Anthropic({ apiKey });
  const model = options.model ?? process.env.BACKLOG_AI_MODEL ?? "claude-opus-4-7";
  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    thinking: { type: "adaptive" },
    system: SYSTEM_PROMPT,
    output_config: {
      format: {
        type: "json_schema",
        schema: PROPOSAL_SCHEMA as unknown as Record<string, unknown>,
      },
    },
    messages: [
      {
        role: "user",
        content: buildUserPrompt(task, repositories),
      },
    ],
  });
  const textBlock = response.content.find(
    (block): block is Anthropic.TextBlock => block.type === "text",
  );
  if (!textBlock) {
    throw new Error("Anthropic response had no text block; cannot parse proposal.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch (error) {
    throw new Error(
      `Anthropic returned invalid JSON: ${error instanceof Error ? error.message : String(error)}\nRaw text: ${textBlock.text.slice(0, 500)}`,
    );
  }
  return validateProposal(parsed, repositories, model);
}

async function suggestSplitOpenAi(
  task: Task,
  repositories: string[],
  options: SuggestOptions & { isCodex?: boolean },
): Promise<SplitProposal> {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new AiSplitterUnavailableError(
      "OPENAI_API_KEY is not set. Export the variable or switch the AI provider in .backlog/config.toml.",
    );
  }
  const model = options.model ?? process.env.BACKLOG_AI_MODEL ?? (options.isCodex ? "gpt-5-codex" : "gpt-5.4");
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(task, repositories) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "split_proposal",
          strict: true,
          schema: PROPOSAL_SCHEMA,
        },
      },
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`OpenAI returned ${response.status}: ${detail.slice(0, 500)}`);
  }
  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = json.choices?.[0]?.message?.content ?? "";
  if (!text) throw new Error("OpenAI response had no message content; cannot parse proposal.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `OpenAI returned invalid JSON: ${error instanceof Error ? error.message : String(error)}\nRaw text: ${text.slice(0, 500)}`,
    );
  }
  return validateProposal(parsed, repositories, model);
}

function validateProposal(parsed: unknown, repositories: string[], model: string): SplitProposal {
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Proposal is not an object");
  }
  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.tasks) || obj.tasks.length < 2 || obj.tasks.length > 6) {
    throw new Error("Proposal must contain 2 to 6 tasks");
  }
  const tasks: ProposedTask[] = obj.tasks.map((raw, index) => {
    if (!raw || typeof raw !== "object") throw new Error(`tasks[${index}] is not an object`);
    const t = raw as Record<string, unknown>;
    const title = String(t.title ?? "").trim();
    const repo = String(t.repo ?? "").trim();
    const risk = t.risk;
    const scopes = Array.isArray(t.scopes) ? t.scopes.map(String).filter((s) => s.length > 0) : [];
    const depends = Array.isArray(t.depends_on_indices)
      ? t.depends_on_indices.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n >= 0)
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
  return {
    tasks,
    rationale: String(obj.rationale ?? "").slice(0, 1000),
    model,
  };
}
