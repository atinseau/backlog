import Anthropic from "@anthropic-ai/sdk";
import type { WorkItem } from "@backlog/schemas";

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

export class AiSplitterUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiSplitterUnavailableError";
  }
}

const SYSTEM_PROMPT = `You are a software-engineering planner that breaks a backlog work item down into a small set of concrete sub-tasks.

For each work item you receive, propose between 2 and 6 sub-tasks. Each task must:
- have a short imperative title (≤ 80 chars)
- target one of the provided repos (use the exact repo id)
- include 1 to 6 file scopes (paths or globs, repo-relative) that the task will touch
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

function buildUserPrompt(workItem: WorkItem, repos: string[]): string {
  const lines: string[] = [];
  lines.push(`Work item id: ${workItem.id}`);
  lines.push(`Title: ${workItem.title}`);
  lines.push(`Priority: ${workItem.priority}`);
  if (workItem.description) lines.push(`Description: ${workItem.description}`);
  if (workItem.acceptance_criteria.length > 0) {
    lines.push("Acceptance criteria:");
    for (const ac of workItem.acceptance_criteria) lines.push(`- ${ac}`);
  }
  if (workItem.labels.length > 0) lines.push(`Labels: ${workItem.labels.join(", ")}`);
  lines.push(`Risk hint: ${workItem.planning.risk}`);
  lines.push("");
  lines.push(`Available repos for this workspace: ${repos.join(", ")}`);
  if (workItem.repo_targets.length > 0) {
    lines.push(`Preferred repo targets on this work item: ${workItem.repo_targets.join(", ")}`);
  }
  lines.push("");
  lines.push("Propose 2 to 6 sub-tasks following the schema. Maximize parallelism where scopes don't overlap.");
  return lines.join("\n");
}

export async function suggestSplit(
  workItem: WorkItem,
  repos: string[],
  options: { apiKey?: string; model?: string } = {},
): Promise<SplitProposal> {
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new AiSplitterUnavailableError(
      "ANTHROPIC_API_KEY is not set. Pass --api-key or export the variable to enable AI suggestions.",
    );
  }
  if (repos.length === 0) {
    throw new Error("No repos available — configure at least one repo in the workspace before splitting.");
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
        content: buildUserPrompt(workItem, repos),
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
  return validateProposal(parsed, repos, model);
}

function validateProposal(parsed: unknown, repos: string[], model: string): SplitProposal {
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
    if (!repos.includes(repo)) {
      throw new Error(
        `tasks[${index}].repo='${repo}' is not in the workspace repos [${repos.join(", ")}]`,
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
