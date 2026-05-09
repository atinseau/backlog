// Curated model catalog for the Agents view dropdown.
//
// Each entry is a { value, label, family, description } tuple. The
// `value` is what we send to the agent CLI as `--model <value>`.
// Claude Code accepts family aliases (sonnet, opus, haiku) and exact
// model ids. Alias rows still send the alias to the CLI, but display
// the currently documented default version/context.
//
// The "latest" entries use the family alias by itself; the upstream CLI
// resolves it to the most recent supported version automatically. This
// matches what users expect from "set and forget" — pick `sonnet` once
// and stay current as Anthropic ships updates.
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
      label: "Claude Sonnet 4.6 (1M)",
      family: "sonnet",
      description: "Balanced Claude Code family alias for daily coding.",
    },
    {
      value: "opus",
      label: "Claude Opus 4.7 (1M)",
      family: "opus",
      description: "Claude Code family alias for harder reasoning tasks.",
    },
    {
      value: "haiku",
      label: "Claude Haiku 4.5 (200k)",
      family: "haiku",
      description: "Claude Code family alias for fast, smaller edits and reviews.",
    },
    {
      value: "claude-sonnet-4-6",
      label: "Claude Sonnet 4.6 (1M)",
      family: "sonnet",
      description: "Pin the current documented Sonnet version for reproducibility.",
    },
    {
      value: "claude-opus-4-7",
      label: "Claude Opus 4.7 (1M)",
      family: "opus",
      description: "Pin the current documented Opus version for reproducibility.",
    },
    {
      value: "claude-haiku-4-5",
      label: "Claude Haiku 4.5 (200k)",
      family: "haiku",
      description: "Pin the current documented Haiku alias for reproducibility.",
    },
    {
      value: "claude-opus-4-20250514",
      label: "Claude Opus 4 (200k)",
      family: "opus",
      description: "Pin a specific Opus version for reproducibility.",
    },
    {
      value: "claude-3-7-sonnet-20250219",
      label: "Claude Sonnet 3.7 (200k)",
      family: "sonnet",
      description: "Pin a specific Sonnet version for reproducibility.",
    },
    {
      value: "claude-haiku-4-5-20251001",
      label: "Claude Haiku 4.5 (200k)",
      family: "haiku",
      description: "Pin a specific Haiku version for reproducibility.",
    },
  ],
  codex: [
    {
      value: "gpt-5.5",
      label: "GPT-5.5 (272k)",
      family: "gpt-5.5",
      description: "Strongest current Codex model for complex coding and professional work.",
    },
    {
      value: "gpt-5.4",
      label: "GPT-5.4 (272k)",
      family: "gpt-5.4",
      description: "Current fallback frontier model for coding and agentic workflows.",
    },
    {
      value: "gpt-5.4-mini",
      label: "GPT-5.4-Mini (272k)",
      family: "gpt-5.4-mini",
      description: "Fast, efficient Codex model for lighter tasks and subagents.",
    },
    {
      value: "gpt-5.3-codex",
      label: "GPT-5.3 Codex (272k)",
      family: "gpt-5.3-codex",
      description: "Previous coding-focused Codex model.",
    },
    {
      value: "gpt-5.2",
      label: "GPT-5.2 (272k)",
      family: "gpt-5.2",
      description: "Previous general-purpose model for coding and agentic tasks.",
    },
  ],
  custom: [],
  manual: [],
};

// Special sentinel value for the "custom..." dropdown option, matched
// in AgentsView to switch to free-text input mode.
export const CUSTOM_MODEL_VALUE = "__custom__";
