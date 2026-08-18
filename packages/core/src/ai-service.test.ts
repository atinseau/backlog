import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";
import { initLayout } from "@backlog/config";
import { completeJsonForProject, completeTextForProject } from "./ai-service.js";
import { createProviderRegistry } from "./providers/registry.js";
import type { AgentProvider, ProviderCompletionRequest, ProviderStructuredRequest } from "./providers/types.js";

function workspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-ai-service-"));
  initLayout({
    root,
    projectName: "ai-service-test",
    repos: [{ id: path.basename(root), path: root, default_branch: "main", enabled: true }],
  });
  return path.join(root, ".backlog");
}

interface Recorder {
  completions: ProviderCompletionRequest[];
  structured: ProviderStructuredRequest[];
}

/** A prompt-only runtime that records what it was asked and replays a canned answer. */
function recordingProvider(
  id: string,
  answer: string,
  aliases: string[] = [],
): { provider: AgentProvider; recorder: Recorder } {
  const recorder: Recorder = { completions: [], structured: [] };
  const provider: AgentProvider = {
    id,
    aliases,
    describe: () => ({
      id,
      displayName: id,
      models: [],
      reasoning: { supported: false, levels: [], allowsCustom: false },
      authModes: ["auto"],
      capabilities: { executeRun: false, textCompletion: true, structuredOutput: true },
      requiresCommand: false,
    }),
    checkReadiness: () => ({ ready: true, reasons: [] }),
    complete: async (request) => {
      recorder.completions.push(request);
      return { text: answer, model: id, usage: null };
    },
    completeStructured: async (request) => {
      recorder.structured.push(request);
      return { value: JSON.parse(answer) as never, model: id, usage: null };
    },
  };
  return { provider, recorder };
}

describe("completeTextForProject", () => {
  it("returns the runtime's answer", async () => {
    const backlogDir = workspace();
    const { provider } = recordingProvider("stub", "Fix the dropdown");

    const result = await completeTextForProject(backlogDir, {
      prompt: "name this",
      registry: createProviderRegistry([provider]),
    });

    expect(result.text).toBe("Fix the dropdown");
  });

  it("passes the system prompt through to the runtime", async () => {
    const backlogDir = workspace();
    const { provider, recorder } = recordingProvider("stub", "x");

    await completeTextForProject(backlogDir, {
      prompt: "p",
      systemPrompt: "be terse",
      registry: createProviderRegistry([provider]),
    });

    expect(recorder.completions[0]?.systemPrompt).toBe("be terse");
  });

  it("gives the runtime a way to read project secrets", async () => {
    const backlogDir = workspace();
    const { provider, recorder } = recordingProvider("stub", "x");

    await completeTextForProject(backlogDir, { prompt: "p", registry: createProviderRegistry([provider]) });

    expect(typeof recorder.completions[0]?.getSecret).toBe("function");
    expect(recorder.completions[0]?.getSecret("NOT_SET")).toBeNull();
  });

  it("hands the runtime the preferred agent's configuration", async () => {
    const backlogDir = workspace();
    // The seeded agents carry `provider: claude`, the legacy id, so this also
    // proves the alias resolution reaches the completion path.
    const { provider, recorder } = recordingProvider("claude-code", "x", ["claude"]);

    await completeTextForProject(backlogDir, {
      prompt: "p",
      preferredAgentIds: ["claude-opus"],
      registry: createProviderRegistry([provider]),
    });

    expect(recorder.completions[0]?.agent?.id).toBe("claude-opus");
    expect(recorder.completions[0]?.agent?.model).toBe("opus");
  });

  it("ignores an agent id that no longer exists", async () => {
    const backlogDir = workspace();
    const { provider, recorder } = recordingProvider("stub", "x");

    await completeTextForProject(backlogDir, {
      prompt: "p",
      preferredAgentIds: ["deleted-agent"],
      registry: createProviderRegistry([provider]),
    });

    expect(recorder.completions[0]?.agent ?? null).toBeNull();
  });
});

describe("completeJsonForProject", () => {
  it("returns the parsed object", async () => {
    const backlogDir = workspace();
    const { provider } = recordingProvider("stub", '{"title":"Add the widget"}');

    const result = await completeJsonForProject<{ title: string }>(backlogDir, {
      prompt: "p",
      schema: { type: "object" },
      schemaName: "task",
      registry: createProviderRegistry([provider]),
    });

    expect(result.value).toEqual({ title: "Add the widget" });
  });

  it("forwards the schema so the runtime can enforce it", async () => {
    const backlogDir = workspace();
    const { provider, recorder } = recordingProvider("stub", "{}");
    const schema = { type: "object", required: ["title"] };

    await completeJsonForProject(backlogDir, {
      prompt: "p",
      schema,
      schemaName: "task",
      registry: createProviderRegistry([provider]),
    });

    expect(recorder.structured[0]?.schema).toEqual(schema);
    expect(recorder.structured[0]?.schemaName).toBe("task");
  });

  it("refuses a runtime that cannot produce structured output", async () => {
    const backlogDir = workspace();
    const { provider } = recordingProvider("stub", "{}");
    const textOnly: AgentProvider = {
      ...provider,
      describe: () => ({
        ...provider.describe(),
        capabilities: { executeRun: false, textCompletion: true, structuredOutput: false },
      }),
    };
    delete (textOnly as { completeStructured?: unknown }).completeStructured;

    await expect(
      completeJsonForProject(backlogDir, {
        prompt: "p",
        schema: {},
        schemaName: "task",
        registry: createProviderRegistry([textOnly]),
      }),
    ).rejects.toThrow(/structured/i);
  });
});
