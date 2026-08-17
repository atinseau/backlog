import { ClaudeCodeProvider } from "./claude-code/provider.js";
import { CodexProvider } from "./codex/provider.js";
import { CustomProvider } from "./custom/provider.js";
import { executableExists } from "./process.js";
import { createProviderRegistry, type ProviderRegistry } from "./registry.js";

export * from "./types.js";
export { createProviderRegistry, type ProviderRegistry } from "./registry.js";
export { executableExists, expandedPath, resolveExecutable } from "./process.js";
export { parseJsonObject } from "./json.js";
export { ClaudeCodeProvider, CLAUDE_CODE_PROVIDER_ID } from "./claude-code/provider.js";
export { CodexProvider, CODEX_PROVIDER_ID } from "./codex/provider.js";
export { CustomProvider, CUSTOM_PROVIDER_ID } from "./custom/provider.js";

// The registry every caller shares. Adding a runtime means adding one entry
// here — nothing else in the codebase branches on provider id.
let defaultRegistry: ProviderRegistry | null = null;

export function providerRegistry(): ProviderRegistry {
  defaultRegistry ??= createProviderRegistry([
    new ClaudeCodeProvider({ executableExists }),
    new CodexProvider({ executableExists }),
    new CustomProvider(),
  ]);
  return defaultRegistry;
}

/** Resolve the runtime backing an agent, or null when its provider is unknown. */
export function providerFor(providerId: string | null | undefined) {
  return providerRegistry().resolve(providerId);
}
