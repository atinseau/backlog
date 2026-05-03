// Pretty-print an agent for the picker, the topbar pill, and the
// Agents view. When the user has set a custom display_name (via
// double-click rename or the CLI), use it as-is. Otherwise compute a
// title-cased name from `provider + model` so the default reads as
// "Claude Opus 4.7" rather than "claude-default".
//
// Also exposes formatAgentDetail() which adds context size +
// provider tag for places that have room (the picker dropdown row,
// not the topbar trigger).

import type { AgentSummary } from "./types.js";

// Context window per known model id. Source: vendor docs as of 2026.
// Falls back to undefined if we don't know — the caller hides the
// chip rather than guessing wrong. Extend this map as new models
// ship.
const MODEL_CONTEXT: Record<string, string> = {
  // Anthropic
  "claude-opus-4-7": "1M",
  "claude-sonnet-4-7": "1M",
  "claude-opus-4-5": "200k",
  "claude-opus-4": "200k",
  "claude-sonnet-4-6": "200k",
  "claude-sonnet-4-5": "200k",
  "claude-sonnet-4": "200k",
  "claude-haiku-4-5": "200k",
  "claude-haiku-4": "200k",
  "claude-3-5-sonnet": "200k",
  "claude-3-5-haiku": "200k",
  // OpenAI / Codex
  "gpt-5-codex": "1M",
  "gpt-5": "1M",
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

const DISPLAY_MODEL_ALIASES: Record<string, string> = {
  sonnet: "claude-sonnet-4-7",
  opus: "claude-opus-4-7",
  haiku: "claude-haiku-4-5",
  "gpt-5-codex": "gpt-5-codex",
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

// Convert "claude-opus-4-7" to "Opus 4.7" — strip the provider
// prefix, replace dashes with spaces, capitalize each word, and
// re-join the version-trailing digits with a dot when it reads as a
// decimal version (4-7 → 4.7).
function prettyModel(model: string): string {
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
  // "4-7" / "4-5" → "4.7" / "4.5". Two-digit pattern between dashes
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
  return DISPLAY_MODEL_ALIASES[model] ?? model;
}

function shouldPrefixProvider(provider: string, modelOnly: string): boolean {
  if (provider === "codex" && /^GPT-/i.test(modelOnly)) return false;
  return true;
}

export interface AgentLabel {
  // Short label, one line — for triggers / chips. e.g. "Claude Opus 4.7"
  short: string;
  // Same plus the context window when known. e.g. "Claude Opus 4.7 (1M)"
  withContext: string;
  // Just the model fragment when the caller already prints the
  // provider separately. e.g. "Opus 4.7"
  modelOnly: string;
  // Context size string, or null if unknown for this model.
  contextSize: string | null;
}

export function formatAgentLabel(agent: { display_name?: string | null; provider: string; model: string | null }): AgentLabel {
  const modelId = displayModelId(agent.model);
  const ctx = modelId ? MODEL_CONTEXT[modelId] ?? null : null;

  // User-set rename always wins. We still expose the context chip on
  // the side so the picker can display "My favourite agent · 1M".
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
