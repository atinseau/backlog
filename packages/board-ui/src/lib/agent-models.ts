// Curated model catalog for the Agents view dropdown.
//
// Each entry is a { value, label, family, description } tuple. The
// `value` is what we send to the agent CLI as `--model <value>` — both
// Claude Code and Codex accept either family aliases (sonnet, opus,
// haiku, gpt-5-codex) or fully-qualified version strings
// (claude-sonnet-4-5, gpt-5-codex-2025-08).
//
// The "latest" entries use the family alias by itself; the upstream CLI
// resolves it to the most recent supported version automatically. This
// matches what the user expects from "set and forget" — pick `sonnet`
// once and stay current as Anthropic ships updates.
//
// Free-text override is still supported: the AgentsView keeps a custom
// option that shows the input field directly so power users can pin a
// specific dated version if they need reproducibility.

export interface ModelChoice {
  value: string;
  label: string;
  family?: string;
  description: string;
}

export const MODEL_CATALOG: Record<string, ModelChoice[]> = {
  claude: [
    {
      value: "sonnet",
      label: "Claude Sonnet (latest)",
      family: "sonnet",
      description: "Balanced default — good price/quality for daily coding.",
    },
    {
      value: "opus",
      label: "Claude Opus (latest)",
      family: "opus",
      description: "Highest quality for hard reasoning tasks. Slower / pricier.",
    },
    {
      value: "haiku",
      label: "Claude Haiku (latest)",
      family: "haiku",
      description: "Fastest and cheapest. Good for trivial edits and reviews.",
    },
    {
      value: "claude-sonnet-4-5",
      label: "Claude Sonnet 4.5 (pinned)",
      family: "sonnet",
      description: "Pin a specific Sonnet version for reproducibility.",
    },
    {
      value: "claude-opus-4-7",
      label: "Claude Opus 4.7 (pinned)",
      family: "opus",
      description: "Pin a specific Opus version for reproducibility.",
    },
    {
      value: "claude-haiku-4-5",
      label: "Claude Haiku 4.5 (pinned)",
      family: "haiku",
      description: "Pin a specific Haiku version for reproducibility.",
    },
  ],
  codex: [
    {
      value: "gpt-5-codex",
      label: "GPT-5 Codex (latest)",
      family: "gpt-5-codex",
      description: "Default Codex tier. Coding-focused.",
    },
    {
      value: "gpt-5",
      label: "GPT-5 (latest)",
      family: "gpt-5",
      description: "General-purpose GPT-5. Less coding-specialised than Codex.",
    },
    {
      value: "o4-mini",
      label: "o4-mini (latest)",
      family: "o4-mini",
      description: "Reasoning-tuned, smaller / cheaper.",
    },
  ],
  custom: [],
  manual: [],
};

// Special sentinel value for the "custom..." dropdown option, matched
// in AgentsView to switch to free-text input mode.
export const CUSTOM_MODEL_VALUE = "__custom__";
