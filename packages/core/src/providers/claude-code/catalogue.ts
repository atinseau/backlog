import type { ProviderModelChoice, ProviderReasoningSupport } from "../types.js";

// Suggestions, not a whitelist. Family aliases (`sonnet`, `opus`, `haiku`)
// let the CLI resolve the newest supported version on its own, which is what
// most users want; the dated ids are there for reproducible runs. Any other
// string the user types is forwarded untouched, so a model shipped tomorrow
// needs no code change here.

export const CLAUDE_CODE_MODELS: ProviderModelChoice[] = [
  {
    value: "sonnet",
    label: "Claude Sonnet (latest)",
    family: "sonnet",
    description: "Balanced family alias for daily coding. Tracks the newest Sonnet automatically.",
  },
  {
    value: "opus",
    label: "Claude Opus (latest)",
    family: "opus",
    description: "Family alias for the hardest reasoning and refactoring work.",
  },
  {
    value: "haiku",
    label: "Claude Haiku (latest)",
    family: "haiku",
    description: "Family alias for fast, cheap edits and reviews.",
  },
  {
    value: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    family: "sonnet",
    description: "Pin an exact Sonnet version for reproducible runs.",
  },
  {
    value: "claude-opus-4-7",
    label: "Claude Opus 4.7",
    family: "opus",
    description: "Pin an exact Opus version for reproducible runs.",
  },
  {
    value: "claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    family: "haiku",
    description: "Pin an exact Haiku version for reproducible runs.",
  },
];

export const CLAUDE_CODE_REASONING: ProviderReasoningSupport = {
  supported: true,
  allowsCustom: true,
  defaultLevel: "medium",
  levels: [
    { value: "low", label: "low", description: "Shortest deliberation. Cheapest, best for mechanical edits." },
    { value: "medium", label: "medium", description: "Default balance of speed and depth." },
    { value: "high", label: "high", description: "More deliberation for tricky changes." },
    { value: "xhigh", label: "xhigh", description: "Extended deliberation for genuinely hard problems." },
    { value: "max", label: "max", description: "Maximum deliberation. Slowest and most expensive." },
  ],
};
