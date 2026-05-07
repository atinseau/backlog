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
      label: "Claude Sonnet 4 (200k)",
      family: "sonnet",
      description: "Balanced Claude Code family alias for daily coding.",
    },
    {
      value: "opus",
      label: "Claude Opus 4.1 (200k)",
      family: "opus",
      description: "Claude Code family alias for harder reasoning tasks.",
    },
    {
      value: "haiku",
      label: "Claude Haiku 3.5 (200k)",
      family: "haiku",
      description: "Claude Code family alias for fast, smaller edits and reviews.",
    },
    {
      value: "claude-sonnet-4-20250514",
      label: "Claude Sonnet 4 (200k)",
      family: "sonnet",
      description: "Pin the current documented Sonnet version for reproducibility.",
    },
    {
      value: "claude-opus-4-1-20250805",
      label: "Claude Opus 4.1 (200k)",
      family: "opus",
      description: "Pin the current documented Opus version for reproducibility.",
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
      value: "claude-3-5-haiku-20241022",
      label: "Claude Haiku 3.5 (200k)",
      family: "haiku",
      description: "Pin a specific Haiku version for reproducibility.",
    },
  ],
  codex: [
    {
      value: "gpt-5-codex",
      label: "GPT-5 Codex (400k)",
      family: "gpt-5-codex",
      description: "Default Codex tier. Coding-focused.",
    },
    {
      value: "gpt-5",
      label: "GPT-5 (400k)",
      family: "gpt-5",
      description: "General-purpose GPT-5. Less coding-specialised than Codex.",
    },
    {
      value: "o4-mini",
      label: "o4-mini (200k)",
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
