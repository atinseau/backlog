import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";
import type { Agent } from "@backlog/schemas";
import { ClaudeCodeProvider } from "./provider.js";
import type { ProviderActivityEvent } from "../types.js";

function scratchDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "backlog-claude-provider-"));
}

/** A stand-in `claude` that prints the given stdout lines and exits with `exitCode`. */
function fakeClaude(dir: string, options: { stdout?: string[]; exitCode?: number; script?: string[] }): string {
  const binary = path.join(dir, "fake-claude.sh");
  const body = options.script ?? [
    ...(options.stdout ?? []).map((line) => `echo ${JSON.stringify(line)}`),
    `exit ${options.exitCode ?? 0}`,
  ];
  fs.writeFileSync(binary, ["#!/usr/bin/env bash", ...body].join("\n"), "utf8");
  fs.chmodSync(binary, 0o755);
  return binary;
}

function agentFixture(command: string, overrides: Partial<Agent> = {}): Agent {
  return {
    id: "claude-default",
    provider: "claude",
    command,
    enabled: true,
    max_concurrent_runs: 1,
    allowed_repos: [],
    allowed_risk: ["low", "medium"],
    capabilities: ["plan", "edit_code"],
    environment: {},
    retry_policy: { mode: "none", max_attempts: 2, reuse_worktree: true },
    ...overrides,
  };
}

function provider(): ClaudeCodeProvider {
  return new ClaudeCodeProvider({ executableExists: () => true });
}

function runRequest(dir: string, agent: Agent, onActivity: (event: ProviderActivityEvent) => void = () => {}) {
  return {
    agent,
    prompt: "do the thing",
    cwd: dir,
    env: { PATH: process.env.PATH ?? "" } as NodeJS.ProcessEnv,
    getSecret: () => null,
    onActivity,
  };
}

const RESULT_LINE = JSON.stringify({
  type: "result",
  result: "Renamed the widget",
  usage: { input_tokens: 120, output_tokens: 45 },
});

describe("ClaudeCodeProvider.executeRun", () => {
  it("reports success and the agent's closing summary", async () => {
    const dir = scratchDir();
    const binary = fakeClaude(dir, { stdout: [RESULT_LINE] });

    const result = await provider().executeRun(runRequest(dir, agentFixture(binary)));

    expect(result.ok).toBe(true);
    expect(result.summary).toBe("Renamed the widget");
    expect(result.failure).toBeUndefined();
  });

  it("extracts token usage from the final result event", async () => {
    const dir = scratchDir();
    const binary = fakeClaude(dir, { stdout: [RESULT_LINE] });

    const result = await provider().executeRun(runRequest(dir, agentFixture(binary)));

    expect(result.usage).toMatchObject({ input_tokens: 120, output_tokens: 45 });
  });

  it("streams one activity event per tool call as the agent works", async () => {
    const dir = scratchDir();
    const binary = fakeClaude(dir, {
      stdout: [
        JSON.stringify({ type: "system", subtype: "init", model: "sonnet", tools: [] }),
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "a.ts" } }] },
        }),
        RESULT_LINE,
      ],
    });
    const seen: ProviderActivityEvent[] = [];

    await provider().executeRun(runRequest(dir, agentFixture(binary), (event) => seen.push(event)));

    expect(seen.map((event) => event.type)).toEqual(["agent.session_init", "agent.read"]);
  });

  it("reports the exit code when the CLI fails", async () => {
    const dir = scratchDir();
    const binary = fakeClaude(dir, { stdout: ["boom"], exitCode: 3 });

    const result = await provider().executeRun(runRequest(dir, agentFixture(binary)));

    expect(result.ok).toBe(false);
    expect(result.failure).toBe("exit code 3");
  });

  it("keeps raw stdout and stderr for the run log", async () => {
    const dir = scratchDir();
    const binary = fakeClaude(dir, { script: ["echo out-line", "echo err-line >&2", "exit 0"] });

    const result = await provider().executeRun(runRequest(dir, agentFixture(binary)));

    expect(result.stdout).toContain("out-line");
    expect(result.stderr).toContain("err-line");
  });

  it("unsets an inherited API key when the agent runs on its subscription", async () => {
    const dir = scratchDir();
    const probe = path.join(dir, "seen-key.txt");
    const binary = fakeClaude(dir, {
      script: [`echo "\${ANTHROPIC_API_KEY-UNSET}" > ${JSON.stringify(probe)}`, "exit 0"],
    });
    const request = runRequest(dir, agentFixture(binary, { auth_mode: "subscription" }));
    request.env.ANTHROPIC_API_KEY = "sk-ant-from-shell";

    await provider().executeRun(request);

    expect(fs.readFileSync(probe, "utf8").trim()).toBe("UNSET");
  });

  it("passes the stored API key through when the agent is pinned to one", async () => {
    const dir = scratchDir();
    const probe = path.join(dir, "seen-key.txt");
    const binary = fakeClaude(dir, {
      script: [`echo "\${ANTHROPIC_API_KEY-UNSET}" > ${JSON.stringify(probe)}`, "exit 0"],
    });

    await provider().executeRun({
      ...runRequest(dir, agentFixture(binary, { auth_mode: "api_key" })),
      getSecret: (key: string) => (key === "ANTHROPIC_API_KEY" ? "sk-ant-stored" : null),
    });

    expect(fs.readFileSync(probe, "utf8").trim()).toBe("sk-ant-stored");
  });

  it("falls back to raw stdout as the summary when no result event is emitted", async () => {
    const dir = scratchDir();
    const binary = fakeClaude(dir, { script: ["echo 'plain text summary'", "exit 0"] });

    const result = await provider().executeRun(runRequest(dir, agentFixture(binary)));

    expect(result.summary).toBe("plain text summary");
  });
});
