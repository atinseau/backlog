import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";
import type { Agent } from "@backlog/schemas";
import { CodexProvider } from "./provider.js";
import type { ProviderActivityEvent } from "../types.js";

function scratchDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "backlog-codex-provider-"));
}

/** A stand-in `codex` that records its argv and stdin, then reports success. */
function fakeCodex(dir: string, options: { lastMessage?: string; stdout?: string[]; exitCode?: number } = {}) {
  const binary = path.join(dir, "fake-codex.sh");
  const argvFile = path.join(dir, "argv.txt");
  const stdinFile = path.join(dir, "stdin.txt");
  fs.writeFileSync(
    binary,
    [
      "#!/usr/bin/env bash",
      `printf '%s\\n' "$@" > ${JSON.stringify(argvFile)}`,
      `cat > ${JSON.stringify(stdinFile)}`,
      // Honour --output-last-message so the summary path is exercised for real.
      'for ((i=1; i<=$#; i++)); do',
      '  if [ "${!i}" = "--output-last-message" ]; then',
      `    next=$((i+1)); printf '%s' ${JSON.stringify(options.lastMessage ?? "")} > "\${!next}"`,
      "  fi",
      "done",
      ...(options.stdout ?? []).map((line) => `echo ${JSON.stringify(line)}`),
      `exit ${options.exitCode ?? 0}`,
    ].join("\n"),
    "utf8",
  );
  fs.chmodSync(binary, 0o755);
  return { binary, argvFile, stdinFile };
}

function agentFixture(command: string, overrides: Partial<Agent> = {}): Agent {
  return {
    id: "codex-default",
    provider: "codex",
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

function provider(installed = true): CodexProvider {
  return new CodexProvider({ executableExists: () => installed });
}

function runRequest(dir: string, agent: Agent, onActivity: (event: ProviderActivityEvent) => void = () => {}) {
  return {
    agent,
    prompt: "do the thing",
    cwd: dir,
    backlogDir: dir,
    scratchDir: dir,
    env: { PATH: process.env.PATH ?? "" } as NodeJS.ProcessEnv,
    getSecret: () => null,
    onActivity,
  };
}

describe("CodexProvider.describe", () => {
  it("answers to the legacy `codex` provider id", () => {
    expect(provider().id).toBe("codex");
  });

  it("exposes the codex effort scale, which differs from Claude's", () => {
    const levels = provider().describe().reasoning.levels.map((level) => level.value);

    expect(levels).toContain("xhigh");
    expect(levels).not.toContain("max");
  });

  it("cannot answer one-shot prompts, only run tasks", () => {
    expect(provider().describe().capabilities).toEqual({
      executeRun: true,
      textCompletion: false,
      structuredOutput: false,
    });
  });
});

describe("CodexProvider.checkReadiness", () => {
  it("requires an OpenAI key, since the CLI has no session of its own", () => {
    const readiness = provider().checkReadiness({ agent: agentFixture("codex"), getSecret: () => null });

    expect(readiness.ready).toBe(false);
    expect(readiness.reasons).toContain("missing_api_key:OPENAI_API_KEY");
  });

  it("is ready once the key is stored and the binary is installed", () => {
    const readiness = provider().checkReadiness({
      agent: agentFixture("codex"),
      getSecret: (key) => (key === "OPENAI_API_KEY" ? "sk-openai" : null),
    });

    expect(readiness).toEqual({ ready: true, reasons: [] });
  });

  it("reports a missing binary", () => {
    const readiness = provider(false).checkReadiness({
      agent: agentFixture("codex"),
      getSecret: () => "sk-openai",
    });

    expect(readiness.reasons).toContain("missing_executable:codex");
  });
});

describe("CodexProvider.executeRun", () => {
  it("feeds the prompt on stdin rather than the command line", async () => {
    const dir = scratchDir();
    const { binary, stdinFile } = fakeCodex(dir);

    await provider().executeRun(runRequest(dir, agentFixture(binary)));

    expect(fs.readFileSync(stdinFile, "utf8")).toBe("do the thing");
  });

  it("defaults to a workspace-write sandbox", async () => {
    const dir = scratchDir();
    const { binary, argvFile } = fakeCodex(dir);

    await provider().executeRun(runRequest(dir, agentFixture(binary)));
    const argv = fs.readFileSync(argvFile, "utf8").split("\n");

    expect(argv[argv.indexOf("--sandbox") + 1]).toBe("workspace-write");
  });

  it("honours the agent's sandbox mode when one is set", async () => {
    const dir = scratchDir();
    const { binary, argvFile } = fakeCodex(dir);

    await provider().executeRun(runRequest(dir, agentFixture(binary, { sandbox_mode: "read-only" })));
    const argv = fs.readFileSync(argvFile, "utf8").split("\n");

    expect(argv[argv.indexOf("--sandbox") + 1]).toBe("read-only");
  });

  it("passes the reasoning effort as a config override", async () => {
    const dir = scratchDir();
    const { binary, argvFile } = fakeCodex(dir);

    await provider().executeRun({ ...runRequest(dir, agentFixture(binary)), reasoningEffort: "high" });

    expect(fs.readFileSync(argvFile, "utf8")).toContain('model_reasoning_effort="high"');
  });

  it("returns the agent's last message as the summary", async () => {
    const dir = scratchDir();
    const { binary } = fakeCodex(dir, { lastMessage: "Renamed the widget" });

    const result = await provider().executeRun(runRequest(dir, agentFixture(binary)));

    expect(result.summary).toBe("Renamed the widget");
  });

  it("streams activity events from the json feed", async () => {
    const dir = scratchDir();
    const { binary } = fakeCodex(dir, {
      stdout: [JSON.stringify({ type: "thread.started", thread_id: "abcdef123456" })],
    });
    const seen: ProviderActivityEvent[] = [];

    await provider().executeRun(runRequest(dir, agentFixture(binary), (event) => seen.push(event)));

    expect(seen.map((event) => event.type)).toEqual(["agent.session_init"]);
  });

  it("reports the exit code when the CLI fails", async () => {
    const dir = scratchDir();
    const { binary } = fakeCodex(dir, { exitCode: 4 });

    const result = await provider().executeRun(runRequest(dir, agentFixture(binary)));

    expect(result.ok).toBe(false);
    expect(result.failure).toBe("exit code 4");
  });
});
