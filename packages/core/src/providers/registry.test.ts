import { describe, expect, it } from "bun:test";
import { createProviderRegistry } from "./registry.js";
import type { AgentProvider, ProviderDescriptor } from "./types.js";

function stubProvider(id: string, aliases: string[] = []): AgentProvider {
  const descriptor: ProviderDescriptor = {
    id,
    displayName: id,
    models: [],
    reasoning: { supported: false, levels: [], allowsCustom: false },
    authModes: ["auto"],
    sandboxModes: [],
    capabilities: { executeRun: true, textCompletion: false, structuredOutput: false },
    requiresCommand: false,
  };
  return {
    id,
    aliases,
    describe: () => descriptor,
    checkReadiness: () => ({ ready: true, reasons: [] }),
  };
}

describe("createProviderRegistry", () => {
  it("resolves a provider by its own id", () => {
    const registry = createProviderRegistry([stubProvider("claude-code")]);

    expect(registry.resolve("claude-code")?.id).toBe("claude-code");
  });

  it("resolves legacy agents.yaml ids through aliases", () => {
    const registry = createProviderRegistry([stubProvider("claude-code", ["claude", "anthropic"])]);

    expect(registry.resolve("claude")?.id).toBe("claude-code");
    expect(registry.resolve("anthropic")?.id).toBe("claude-code");
  });

  it("ignores case and surrounding whitespace", () => {
    const registry = createProviderRegistry([stubProvider("claude-code", ["claude"])]);

    expect(registry.resolve("  Claude  ")?.id).toBe("claude-code");
  });

  it("returns null for an unknown provider instead of throwing", () => {
    const registry = createProviderRegistry([stubProvider("claude-code")]);

    expect(registry.resolve("gemini")).toBeNull();
    expect(registry.resolve("")).toBeNull();
  });

  it("lists registered providers in registration order", () => {
    const registry = createProviderRegistry([stubProvider("claude-code"), stubProvider("codex")]);

    expect(registry.list().map((provider) => provider.id)).toEqual(["claude-code", "codex"]);
  });

  it("exposes every descriptor so the API can serve the catalogue", () => {
    const registry = createProviderRegistry([stubProvider("claude-code"), stubProvider("codex")]);

    expect(registry.describeAll().map((descriptor) => descriptor.id)).toEqual(["claude-code", "codex"]);
  });

  it("refuses two providers claiming the same id", () => {
    expect(() => createProviderRegistry([stubProvider("claude-code"), stubProvider("claude-code")])).toThrow(
      /claude-code/,
    );
  });

  it("refuses an alias already taken by another provider", () => {
    expect(() =>
      createProviderRegistry([stubProvider("claude-code", ["claude"]), stubProvider("codex", ["claude"])]),
    ).toThrow(/claude/);
  });
});
