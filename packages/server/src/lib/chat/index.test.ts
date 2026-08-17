import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";
import { initLayout } from "@backlog/config";
import { runOrchestratorChat } from "./index.js";
import type { ChatMessage } from "./types.js";

let backlogDir: string;
let projectRoot: string;

beforeEach(() => {
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-chat-turn-"));
  initLayout({
    root: projectRoot,
    projectName: "chat-turn-test",
    repos: [{ id: "backlog", path: projectRoot, default_branch: "main", enabled: true }],
  });
  backlogDir = path.join(projectRoot, ".backlog");
});

interface Captured {
  prompt: string;
  systemPrompt: string;
  resumeSessionId?: string | undefined;
}

/** Records what the CLI backend would have been asked to run. */
function capturing(): { calls: Captured[]; backends: Parameters<typeof runOrchestratorChat>[0]["backends"] } {
  const calls: Captured[] = [];
  return {
    calls,
    backends: {
      claudeCode: async (input) => {
        calls.push({
          prompt: input.prompt,
          systemPrompt: input.systemPrompt,
          resumeSessionId: input.resumeSessionId,
        });
      },
      anthropicApi: async () => {},
      select: () => ({ kind: "claude-code" }),
    },
  };
}

const conversation: ChatMessage[] = [
  { role: "user", content: "what is running?" },
  { role: "assistant", content: "Two runs." },
  { role: "user", content: "and the second one?" },
];

describe("runOrchestratorChat on the CLI backend", () => {
  it("sends only the newest turn when resuming", async () => {
    const { calls, backends } = capturing();

    await runOrchestratorChat({
      backlogDir,
      projectRoot,
      messages: conversation,
      sessionId: "abc-123",
      onEvent: () => {},
      backends,
    });

    expect(calls[0]?.prompt).toBe("and the second one?");
    expect(calls[0]?.resumeSessionId).toBe("abc-123");
  });

  it("sends only the newest turn on a fresh session too", async () => {
    // Replaying the transcript would defeat the point: the CLI keeps the
    // conversation, and a re-sent history is billed as new input every turn.
    const { calls, backends } = capturing();

    await runOrchestratorChat({
      backlogDir,
      projectRoot,
      messages: conversation,
      onEvent: () => {},
      backends,
    });

    expect(calls[0]?.prompt).toBe("and the second one?");
    expect(calls[0]?.prompt).not.toContain("what is running?");
    expect(calls[0]?.resumeSessionId).toBeUndefined();
  });

  it("carries the project context in the system prompt", async () => {
    const { calls, backends } = capturing();

    await runOrchestratorChat({
      backlogDir,
      projectRoot,
      messages: conversation,
      onEvent: () => {},
      backends,
    });

    expect(calls[0]?.systemPrompt).toContain("autonomy_mode");
    expect(calls[0]?.systemPrompt).toContain("co-pilot");
  });
});

describe("runOrchestratorChat backend selection", () => {
  it("routes to the API backend when that is what is available", async () => {
    const seen: string[] = [];

    await runOrchestratorChat({
      backlogDir,
      projectRoot,
      messages: conversation,
      onEvent: () => {},
      backends: {
        claudeCode: async () => {
          seen.push("cli");
        },
        anthropicApi: async () => {
          seen.push("api");
        },
        select: () => ({ kind: "anthropic-api", apiKey: "sk-ant" }),
      },
    });

    expect(seen).toEqual(["api"]);
  });

  it("gives the API backend the whole transcript, since that API is stateless", async () => {
    let received: ChatMessage[] = [];

    await runOrchestratorChat({
      backlogDir,
      projectRoot,
      messages: conversation,
      onEvent: () => {},
      backends: {
        claudeCode: async () => {},
        anthropicApi: async (input) => {
          received = input.messages;
        },
        select: () => ({ kind: "anthropic-api", apiKey: "sk-ant" }),
      },
    });

    expect(received).toHaveLength(3);
  });
});
