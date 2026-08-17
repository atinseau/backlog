import { AnthropicApiProvider } from "./anthropic-api/provider.js";
import { ClaudeCodeProvider } from "./claude-code/provider.js";
import { CustomProvider } from "./custom/provider.js";
import { executableExists } from "./process.js";
import { createProviderRegistry, type ProviderRegistry } from "./registry.js";

export * from "./types.js";
export { createProviderRegistry, type ProviderRegistry } from "./registry.js";
export { executableExists, expandedPath, resolveExecutable, spawnStreaming, describeProcessFailure } from "./process.js";
export { parseJsonObject } from "./json.js";
export {
  resolveCompletionProvider,
  CompletionUnavailableError,
  type ResolvedCompletionProvider,
} from "./completion-provider.js";
export { ClaudeCodeProvider, CLAUDE_CODE_PROVIDER_ID } from "./claude-code/provider.js";
export { buildClaudeCodeCommand, type ProviderCommand, type ClaudeCodeCommandInput } from "./claude-code/command.js";
export { CustomProvider, CUSTOM_PROVIDER_ID } from "./custom/provider.js";
export {
  AnthropicApiProvider,
  ANTHROPIC_API_PROVIDER_ID,
  ANTHROPIC_API_KEY,
  resolveAnthropicModel,
} from "./anthropic-api/provider.js";

// The registry every caller shares. Adding a runtime means adding one entry
// here — nothing else in the codebase branches on provider id. Order is the
// catalogue order shown to users; completion fallback applies its own rule.
let defaultRegistry: ProviderRegistry | null = null;

export function providerRegistry(): ProviderRegistry {
  defaultRegistry ??= createProviderRegistry([
    new ClaudeCodeProvider({ executableExists }),
    new CustomProvider(),
    new AnthropicApiProvider(),
  ]);
  return defaultRegistry;
}

/** Resolve the runtime backing an agent, or null when its provider is unknown. */
export function providerFor(providerId: string | null | undefined) {
  return providerRegistry().resolve(providerId);
}
