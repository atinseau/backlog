import { fetchProviders } from "./api.js";
import type { ProviderModelChoice, ProviderReasoningLevel, ProviderSummary } from "./types.js";

// The runtime catalogue, served by GET /providers and cached for the session.
// Before this existed the board carried its own copy of every model id and
// effort level, which drifted from the server the moment either changed.

let providers = $state<ProviderSummary[]>([]);
let loaded = $state(false);
let inflight: Promise<void> | null = null;

export function providerCatalogue(): ProviderSummary[] {
  return providers;
}

export function providerCatalogueLoaded(): boolean {
  return loaded;
}

/** Load once per session. Concurrent callers share the same request. */
export async function loadProviders(): Promise<void> {
  if (loaded) return;
  inflight ??= fetchProviders()
    .then((result) => {
      providers = result;
      loaded = true;
    })
    .catch(() => {
      // A board that cannot reach /providers still works: the pickers fall
      // back to free-text entry rather than blocking the user.
      loaded = true;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Resolve by canonical id or by the legacy id stored on an agent. */
export function findProvider(providerId: string | null | undefined): ProviderSummary | null {
  if (!providerId) return null;
  const needle = providerId.trim().toLowerCase();
  return (
    providers.find((provider) => provider.id.toLowerCase() === needle) ??
    // Legacy ids (`claude`, `anthropic`) are not in the descriptor, so match on
    // the family prefix the canonical id starts with.
    providers.find((provider) => provider.id.toLowerCase().startsWith(needle)) ??
    null
  );
}

/** Runtimes that can actually back an agent. Prompt-only ones are excluded. */
export function executableProviders(): ProviderSummary[] {
  return providers.filter((provider) => provider.capabilities.execute_run);
}

export function modelsForProvider(providerId: string | null | undefined): ProviderModelChoice[] {
  return findProvider(providerId)?.models ?? [];
}

export function reasoningLevelsForProvider(providerId: string | null | undefined): ProviderReasoningLevel[] {
  const provider = findProvider(providerId);
  return provider?.reasoning.supported ? provider.reasoning.levels : [];
}

export function defaultReasoningForProvider(providerId: string | null | undefined): string | null {
  const provider = findProvider(providerId);
  if (!provider?.reasoning.supported) return null;
  return provider.reasoning.default_level ?? provider.reasoning.levels[0]?.value ?? null;
}

export function isReasoningLevelSupported(
  providerId: string | null | undefined,
  value: string | null | undefined,
): boolean {
  if (!value) return false;
  const provider = findProvider(providerId);
  if (!provider?.reasoning.supported) return false;
  // A runtime that forwards unlisted levels accepts anything the user types.
  if (provider.reasoning.allows_custom) return true;
  return provider.reasoning.levels.some((level) => level.value === value);
}

export function authModesForProvider(providerId: string | null | undefined): ProviderSummary["auth_modes"] {
  return findProvider(providerId)?.auth_modes ?? [];
}

export function providerRequiresCommand(providerId: string | null | undefined): boolean {
  return findProvider(providerId)?.requires_command ?? false;
}
