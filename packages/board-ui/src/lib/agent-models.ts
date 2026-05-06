// Curated model catalog for the Agents view dropdown.
//
// Each entry is a { value, label, family, description } tuple. The
// `value` is what we send to the agent CLI as `--model <value>`.
// Claude Code accepts family aliases (sonnet, opus, haiku) and exact
// model ids. Alias rows intentionally do not display invented version
// numbers or context windows; the upstream CLI resolves them.
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
      label: "Claude Sonnet",
      family: "sonnet",
      description: "Balanced Claude Code family alias for daily coding.",
    },
    {
      value: "opus",
      label: "Claude Opus",
      family: "opus",
      description: "Claude Code family alias for harder reasoning tasks.",
    },
    {
      value: "haiku",
      label: "Claude Haiku",
      family: "haiku",
      description: "Claude Code family alias for fast, smaller edits and reviews.",
    },
    {
      value: "claude-sonnet-4-5",
      label: "Claude Sonnet 4.5",
      family: "sonnet",
      description: "Pin a specific Sonnet version for reproducibility.",
    },
    {
      value: "claude-sonnet-4",
      label: "Claude Sonnet 4",
      family: "sonnet",
      description: "Pin a specific Sonnet version for reproducibility.",
    },
    {
      value: "claude-opus-4-1",
      label: "Claude Opus 4.1",
      family: "opus",
      description: "Pin a specific Opus version for reproducibility.",
    },
    {
      value: "claude-haiku-4-5",
      label: "Claude Haiku 4.5",
      family: "haiku",
      description: "Pin a specific Haiku version for reproducibility.",
    },
  ],
  codex: [
    {
      value: "gpt-5-codex",
      label: "GPT-5 Codex",
      family: "gpt-5-codex",
      description: "Default Codex tier. Coding-focused.",
    },
    {
      value: "gpt-5",
      label: "GPT-5",
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
