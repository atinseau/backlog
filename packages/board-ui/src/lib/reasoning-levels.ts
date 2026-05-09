export interface ReasoningLevel {
  value: string;
  label: string;
  description: string;
}

const CLAUDE_REASONING_LEVELS: ReasoningLevel[] = [
  { value: "low", label: "low", description: "Claude Code --effort low" },
  { value: "medium", label: "medium", description: "Claude Code --effort medium" },
  { value: "high", label: "high", description: "Claude Code --effort high" },
  { value: "max", label: "max", description: "Claude Code --effort max" },
];

const CODEX_REASONING_LEVELS: ReasoningLevel[] = [
  { value: "low", label: "low", description: "Codex model_reasoning_effort low" },
  { value: "medium", label: "medium", description: "Codex model_reasoning_effort medium" },
  { value: "high", label: "high", description: "Codex model_reasoning_effort high" },
  { value: "xhigh", label: "xhigh", description: "Codex model_reasoning_effort xhigh" },
];

export function reasoningLevelsForProvider(provider: string | null | undefined): ReasoningLevel[] {
  if (provider === "claude" || provider === "anthropic") return CLAUDE_REASONING_LEVELS;
  if (provider === "codex" || provider === "openai") return CODEX_REASONING_LEVELS;
  return [];
}

export function defaultReasoningForProvider(provider: string | null | undefined): string | null {
  const levels = reasoningLevelsForProvider(provider);
  if (levels.length === 0) return null;
  return levels.find((level) => level.value === "medium")?.value ?? levels[0]?.value ?? null;
}

export function isReasoningLevelSupported(provider: string | null | undefined, value: string | null | undefined): boolean {
  if (!value) return false;
  return reasoningLevelsForProvider(provider).some((level) => level.value === value);
}
