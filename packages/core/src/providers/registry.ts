import type { AgentProvider, ProviderDescriptor, ProviderId } from "./types.js";

// Single lookup table from the `provider` string in agents.yaml to the
// runtime that serves it. Aliases keep historical ids (`claude`) working
// while the canonical ids describe what actually runs.

export interface ProviderRegistry {
  /** Resolve by canonical id or alias. Null when nothing matches. */
  resolve(providerId: string | null | undefined): AgentProvider | null;
  list(): AgentProvider[];
  describeAll(): ProviderDescriptor[];
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

export function createProviderRegistry(providers: AgentProvider[]): ProviderRegistry {
  const byKey = new Map<string, AgentProvider>();

  const claim = (key: string, provider: AgentProvider): void => {
    const normalized = normalize(key);
    const existing = byKey.get(normalized);
    if (existing) {
      throw new Error(
        `Provider id conflict on '${key}': ${existing.id} and ${provider.id} both claim it.`,
      );
    }
    byKey.set(normalized, provider);
  };

  for (const provider of providers) {
    claim(provider.id, provider);
    for (const alias of provider.aliases) {
      claim(alias, provider);
    }
  }

  return {
    resolve(providerId: string | null | undefined): AgentProvider | null {
      if (!providerId) return null;
      return byKey.get(normalize(providerId)) ?? null;
    },
    list: () => [...providers],
    describeAll: () => providers.map((provider) => provider.describe()),
  };
}

export type { ProviderId };
