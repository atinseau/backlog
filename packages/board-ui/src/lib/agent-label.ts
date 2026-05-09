// Pretty-print an agent for the picker, the topbar pill, and the
// Agents view. When the user has set a custom display_name (via
// double-click rename or the CLI), use it as-is. Otherwise compute a
// title-cased name from `provider + model` so the default reads as
// "Claude Sonnet" rather than "claude-default".
//
// Also exposes formatAgentDetail() which adds context size +
// provider tag for places that have room (the picker dropdown row,
// not the topbar trigger).

import type { AgentSummary } from "./types.js";

// Context window per documented model id. Family aliases still go to
// the provider CLI unchanged, but the UI displays the currently
// documented default so the header remains useful without inventing
// versions.
const MODEL_CONTEXT: Record<string, string> = {
  // Anthropic
  "claude-opus-4-7": "1M",
  "claude-sonnet-4-6": "1M",
  "claude-haiku-4-5-20251001": "200k",
  "claude-haiku-4-5": "200k",
  "claude-opus-4-1-20250805": "200k",
  "claude-opus-4-20250514": "200k",
  "claude-sonnet-4-20250514": "200k",
  "claude-3-7-sonnet-20250219": "200k",
  "claude-3-5-haiku-20241022": "200k",
  "claude-opus-4-1": "200k",
  "claude-opus-4": "200k",
  "claude-sonnet-4": "200k",
  "claude-3-7-sonnet": "200k",
  "claude-3-5-sonnet": "200k",
  "claude-3-5-haiku": "200k",
  // OpenAI
  "gpt-5.5": "272k",
  "gpt-5.4": "272k",
  "gpt-5.4-mini": "272k",
  "gpt-5.3-codex": "272k",
  "gpt-5.3-codex-spark": "272k",
  "gpt-5.2": "272k",
  "gpt-4.1": "1M",
  "gpt-4o": "128k",
  "gpt-4o-mini": "128k",
  "o1": "200k",
  "o1-mini": "128k",
  "o3": "200k",
  "o3-mini": "200k",
  // Google
  "gemini-2.5-pro": "2M",
  "gemini-2.5-flash": "1M",
  "gemini-1.5-pro": "2M",
  // Meta / open weights
  "llama-3.3-70b": "128k",
};

const PROVIDER_LABELS: Record<string, string> = {
  claude: "Claude",
  anthropic: "Claude",
  codex: "Codex",
  openai: "OpenAI",
  custom: "Custom",
  manual: "Manual",
  google: "Gemini",
  gemini: "Gemini",
};

const FAMILY_ALIAS_LABELS: Record<string, string> = {
  sonnet: "Sonnet",
  opus: "Opus",
  haiku: "Haiku",
};

const DISPLAY_MODEL_ALIASES: Record<string, string> = {
  sonnet: "claude-sonnet-4-6",
  opus: "claude-opus-4-7",
  haiku: "claude-haiku-4-5",
  "claude-sonnet-4-5": "claude-sonnet-4-6",
  "claude-haiku-4-5": "claude-haiku-4-5",
};

const MODEL_DISPLAY_NAMES: Record<string, string> = {
  "claude-opus-4-7": "Opus 4.7",
  "claude-sonnet-4-6": "Sonnet 4.6",
  "claude-haiku-4-5-20251001": "Haiku 4.5",
  "claude-haiku-4-5": "Haiku 4.5",
  "claude-opus-4-1-20250805": "Opus 4.1",
  "claude-opus-4-20250514": "Opus 4",
  "claude-sonnet-4-20250514": "Sonnet 4",
  "claude-3-7-sonnet-20250219": "Sonnet 3.7",
  "claude-3-5-haiku-20241022": "Haiku 3.5",
  "gpt-5.5": "GPT-5.5",
  "gpt-5.4": "GPT-5.4",
  "gpt-5.4-mini": "GPT-5.4-Mini",
  "gpt-5.3-codex": "GPT-5.3 Codex",
  "gpt-5.3-codex-spark": "GPT-5.3 Codex Spark",
  "gpt-5.2": "GPT-5.2",
};

// Convert "claude-opus-4-1" to "Opus 4.1" — strip the provider
// prefix, replace dashes with spaces, capitalize each word, and
// re-join the version-trailing digits with a dot when it reads as a
// decimal version (4-5 → 4.5).
function prettyModel(model: string): string {
  const alias = FAMILY_ALIAS_LABELS[model];
  if (alias) return alias;
  const documentedName = MODEL_DISPLAY_NAMES[model];
  if (documentedName) return documentedName;
  if (model.startsWith("gpt-")) {
    const rest = model
      .slice(4)
      .replace(/-(\d+)-(\d+)\b/g, "-$1.$2")
      .split("-")
      .map((part) => part.length === 0 ? part : part[0]!.toUpperCase() + part.slice(1))
      .join(" ");
    return `GPT-${rest}`;
  }
  let rest = model;
  // Strip vendor prefix if present.
  for (const prefix of ["claude-", "gpt-", "openai-", "anthropic-", "gemini-", "llama-"]) {
    if (rest.startsWith(prefix)) {
      rest = rest.slice(prefix.length);
      break;
    }
  }
  // "4-5" / "4-1" → "4.5" / "4.1". Two-digit pattern between dashes
  // at the end of a token is treated as a version number.
  rest = rest.replace(/-(\d+)-(\d+)\b/g, "-$1.$2");
  if (rest === "5-codex") return "GPT-5 Codex";
  return rest
    .split("-")
    .map((part) => part.length === 0 ? part : part[0]!.toUpperCase() + part.slice(1))
    .join(" ");
}

function displayModelId(model: string | null): string | null {
  if (!model) return null;
  const value = model.trim();
  return (DISPLAY_MODEL_ALIASES[value] ?? value) || null;
}

function shouldPrefixProvider(provider: string, modelOnly: string): boolean {
  if (provider === "codex" && /^GPT-/i.test(modelOnly)) return false;
  return true;
}

export interface AgentLabel {
  // Short label, one line — for triggers / chips. e.g. "Claude Opus 4.1"
  short: string;
  // Same plus the context window when known. e.g. "Claude Opus 4.1 (200k)"
  withContext: string;
  // Just the model fragment when the caller already prints the
  // provider separately. e.g. "Opus 4.1"
  modelOnly: string;
  // Context size string, or null if unknown for this model.
  contextSize: string | null;
}

export function formatAgentLabel(agent: { display_name?: string | null; provider: string; model: string | null }): AgentLabel {
  const modelId = displayModelId(agent.model);
  const ctx = modelId ? MODEL_CONTEXT[modelId] ?? null : null;

  // User-set rename always wins. We still expose the context chip on
  // the side so the picker can display "Review agent · 200k".
  if (agent.display_name && agent.display_name.trim().length > 0) {
    const name = agent.display_name.trim();
    return {
      short: name,
      withContext: ctx ? `${name} (${ctx})` : name,
      modelOnly: modelId ? prettyModel(modelId) : name,
      contextSize: ctx,
    };
  }

  const providerLabel = PROVIDER_LABELS[agent.provider] ?? agent.provider;
  const modelOnly = modelId ? prettyModel(modelId) : "";
  const short = modelOnly
    ? (shouldPrefixProvider(agent.provider, modelOnly) ? `${providerLabel} ${modelOnly}` : modelOnly)
    : providerLabel;
  const withContext = ctx ? `${short} (${ctx})` : short;
  return { short, withContext, modelOnly, contextSize: ctx };
}

// Convenience for places that just want the string. Wraps the most
// common case (full name with context).
export function agentLabel(agent: AgentSummary): string {
  return formatAgentLabel(agent).withContext;
}
