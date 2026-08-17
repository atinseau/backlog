import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";
import type { Agent } from "@backlog/schemas";
import { CustomProvider } from "./provider.js";

function scratchDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "backlog-custom-provider-"));
}

function agentFixture(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "custom-default",
    provider: "custom",
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

function runRequest(dir: string, agent: Agent) {
  return {
    agent,
    prompt: "do the thing",
    cwd: dir,
    backlogDir: dir,
    env: { PATH: process.env.PATH ?? "" } as NodeJS.ProcessEnv,
    getSecret: () => null,
    onActivity: () => {},
  };
}

const provider = new CustomProvider();

describe("CustomProvider.describe", () => {
  it("requires the agent to bring its own command", () => {
    expect(provider.describe().requiresCommand).toBe(true);
  });

  it("offers no model or reasoning catalogue — the command owns those", () => {
    const descriptor = provider.describe();

    expect(descriptor.models).toEqual([]);
    expect(descriptor.reasoning.supported).toBe(false);
  });

  it("needs no credentials of its own", () => {
    expect(provider.describe().authModes).toEqual(["auto"]);
  });
});

describe("CustomProvider.checkReadiness", () => {
  it("blocks an agent with no command", () => {
    const readiness = provider.checkReadiness({ agent: agentFixture(), getSecret: () => null });

    expect(readiness.ready).toBe(false);
    expect(readiness.reasons).toContain("missing_command");
  });

  it("is ready as soon as a command is configured", () => {
    const readiness = provider.checkReadiness({
      agent: agentFixture({ command: "./run.sh" }),
      getSecret: () => null,
    });

    expect(readiness).toEqual({ ready: true, reasons: [] });
  });
});

describe("CustomProvider.executeRun", () => {
  it("runs the command through a shell so pipelines work", async () => {
    const dir = scratchDir();
    const marker = path.join(dir, "ran.txt");

    const result = await provider.executeRun(
      runRequest(dir, agentFixture({ command: `echo hello | tr a-z A-Z > ${JSON.stringify(marker)}` })),
    );

    expect(result.ok).toBe(true);
    expect(fs.readFileSync(marker, "utf8").trim()).toBe("HELLO");
  });

  it("hands the task prompt to the command on stdin", async () => {
    const dir = scratchDir();
    const captured = path.join(dir, "stdin.txt");

    await provider.executeRun(runRequest(dir, agentFixture({ command: `cat > ${JSON.stringify(captured)}` })));

    expect(fs.readFileSync(captured, "utf8")).toBe("do the thing");
  });

  it("also exposes the prompt as BACKLOG_PROMPT for commands that ignore stdin", async () => {
    const dir = scratchDir();
    const captured = path.join(dir, "env.txt");

    await provider.executeRun(
      runRequest(dir, agentFixture({ command: `printf '%s' "$BACKLOG_PROMPT" > ${JSON.stringify(captured)}` })),
    );

    expect(fs.readFileSync(captured, "utf8")).toBe("do the thing");
  });

  it("reports the exit code when the command fails", async () => {
    const dir = scratchDir();

    const result = await provider.executeRun(runRequest(dir, agentFixture({ command: "exit 7" })));

    expect(result.ok).toBe(false);
    expect(result.failure).toBe("exit code 7");
  });

  it("refuses to run without a command instead of spawning a shell", async () => {
    const dir = scratchDir();

    await expect(provider.executeRun(runRequest(dir, agentFixture()))).rejects.toThrow(/command/i);
  });
});
