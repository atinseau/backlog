import { describe, expect, it } from "bun:test";
import type { Agent } from "@backlog/schemas";
import { contextFor } from "../../contexts/contexts.js";
import { orchestratorToolNames } from "../../orchestrator-tools.js";
import { buildRunCommand, ClaudeCodeProvider, executionCliRole } from "./provider.js";

function agentFixture(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "claude-default",
    provider: "claude",
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

function providerWith(options: { installed?: boolean } = {}): ClaudeCodeProvider {
  return new ClaudeCodeProvider({ executableExists: () => options.installed ?? true });
}

const noSecrets = () => null;

describe("ClaudeCodeProvider.describe", () => {
  it("answers to the legacy `claude` provider id", () => {
    expect(providerWith().aliases).toContain("claude");
  });

  it("advertises a model catalogue that stays open to unlisted values", () => {
    const descriptor = providerWith().describe();

    expect(descriptor.models.map((model) => model.value)).toContain("sonnet");
    expect(descriptor.models.map((model) => model.value)).toContain("opus");
    expect(descriptor.models.length).toBeGreaterThan(2);
  });

  it("supports reasoning effort and forwards unlisted levels", () => {
    const { reasoning } = providerWith().describe();

    expect(reasoning.supported).toBe(true);
    expect(reasoning.allowsCustom).toBe(true);
    expect(reasoning.defaultLevel).toBe("medium");
  });

  it("lists exactly the effort levels the CLI accepts", () => {
    const { reasoning } = providerWith().describe();

    expect(reasoning.levels.map((level) => level.value)).toEqual(["low", "medium", "high", "xhigh", "max"]);
  });

  it("can both run tasks and answer one-shot prompts", () => {
    const { capabilities } = providerWith().describe();

    expect(capabilities).toEqual({ executeRun: true, textCompletion: true, structuredOutput: true });
  });

  it("offers the subscription as a first-class auth mode", () => {
    expect(providerWith().describe().authModes).toEqual(["auto", "subscription", "api_key"]);
  });
});

describe("ClaudeCodeProvider.checkReadiness", () => {
  it("is ready without any API key, because the CLI carries its own session", () => {
    const readiness = providerWith({ installed: true }).checkReadiness({
      agent: agentFixture(),
      getSecret: noSecrets,
    });

    expect(readiness).toEqual({ ready: true, reasons: [] });
  });

  it("reports a missing executable", () => {
    const readiness = providerWith({ installed: false }).checkReadiness({
      agent: agentFixture(),
      getSecret: noSecrets,
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.reasons).toContain("missing_executable:claude");
  });

  it("names the custom executable when the agent overrides it", () => {
    const readiness = providerWith({ installed: false }).checkReadiness({
      agent: agentFixture({ command: "/opt/claude" }),
      getSecret: noSecrets,
    });

    expect(readiness.reasons).toContain("missing_executable:/opt/claude");
  });

  it("blocks an api_key-pinned agent until the key exists", () => {
    const readiness = providerWith({ installed: true }).checkReadiness({
      agent: agentFixture({ auth_mode: "api_key" }),
      getSecret: noSecrets,
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.reasons).toContain("missing_api_key:ANTHROPIC_API_KEY");
  });

  it("clears an api_key-pinned agent once the key is stored", () => {
    const readiness = providerWith({ installed: true }).checkReadiness({
      agent: agentFixture({ auth_mode: "api_key" }),
      getSecret: (key) => (key === "ANTHROPIC_API_KEY" ? "sk-ant-stored" : null),
    });

    expect(readiness).toEqual({ ready: true, reasons: [] });
  });

  it("stays ready in subscription mode even with no key anywhere", () => {
    const readiness = providerWith({ installed: true }).checkReadiness({
      agent: agentFixture({ auth_mode: "subscription" }),
      getSecret: noSecrets,
    });

    expect(readiness.ready).toBe(true);
  });
});

describe("buildRunCommand", () => {
  it("attaches the execution tool set to a coding run, and nothing else", () => {
    const command = buildRunCommand({
      agent: agentFixture(),
      prompt: "do the work",
      cwd: "/tmp/worktree",
      backlogDir: "/tmp/project/.backlog",
      env: {},
      getSecret: noSecrets,
      onActivity: () => {},
    });

    const config = JSON.parse(command.args[command.args.indexOf("--mcp-config") + 1]!) as {
      mcpServers: Record<string, { args: string[] }>;
    };
    // The *pair*, not the two strings independently: a `--project` path can
    // supply the word "execution" all by itself, so a `toContain` pair would
    // still pass against `--audience orchestrator`. This is the one assertion
    // standing between a refactor and a privilege escalation.
    const args = config.mcpServers.backlog!.args;
    expect(args[args.indexOf("--audience") + 1]).toBe("execution");
    expect(args.slice(-2)).toEqual(["--project", "/tmp/project/.backlog"]);

    const allowed = command.args[command.args.indexOf("--allowedTools") + 1]!.split(",");
    expect(allowed).toEqual([...contextFor("execution").mcpTools].map((name) => `mcp__backlog__${name}`));
    expect(allowed).toContain("mcp__backlog__trace_write");
    for (const name of orchestratorToolNames()) {
      expect(allowed).not.toContain(`mcp__backlog__${name}`);
    }
    expect(command.args).not.toContain("--strict-mcp-config");
  });

  // A coding run keeps every built-in tool — it is here to write code. The one
  // thing the table closes is the route back into Backlog's own CLI.
  it("closes the Backlog CLI to a coding run without taking its other tools", () => {
    const command = buildRunCommand({
      agent: agentFixture(),
      prompt: "do the work",
      cwd: "/tmp/worktree",
      backlogDir: "/tmp/project/.backlog",
      env: {},
      getSecret: noSecrets,
      onActivity: () => {},
    });

    const denied = command.args[command.args.indexOf("--disallowedTools") + 1]!.split(",");
    expect(denied).toEqual(["Bash(backlog:*)"]);
    expect(denied).not.toContain("Bash");
  });

  // The CLI closure and the façade that replaces it are one trade, and there is
  // no longer a condition that could hand out one half without the other.
  it("closes the CLI on every run, because every run gets the façade", () => {
    const agent = agentFixture();
    const command = buildRunCommand({
      agent,
      prompt: "do the work",
      cwd: "/tmp/worktree",
      backlogDir: "/tmp/project/.backlog",
      env: {},
      getSecret: noSecrets,
      onActivity: () => {},
    });

    expect(command.args[command.args.indexOf("--permission-mode") + 1]).toBe("bypassPermissions");
    expect(command.args[command.args.indexOf("--disallowedTools") + 1]).toBe("Bash(backlog:*)");
    expect(command.args).toContain("--mcp-config");
    expect(executionCliRole()).toBe("execution");
  });

  it("declares the run context on the MCP server rather than trusting inheritance", () => {
    const command = buildRunCommand({
      agent: agentFixture(),
      prompt: "do the work",
      cwd: "/tmp/worktree",
      backlogDir: "/tmp/project/.backlog",
      env: { BACKLOG_RUN_ID: "run_1", BACKLOG_TASK_ID: "task_1", BACKLOG_SUBTASK_ID: "subtask_1" },
      getSecret: noSecrets,
      onActivity: () => {},
    });

    const config = JSON.parse(command.args[command.args.indexOf("--mcp-config") + 1]!) as {
      mcpServers: Record<string, { env: Record<string, string> }>;
    };
    expect(config.mcpServers.backlog?.env).toEqual({
      BACKLOG_RUN_ID: "run_1",
      BACKLOG_TASK_ID: "task_1",
      BACKLOG_SUBTASK_ID: "subtask_1",
    });
  });

  it("omits the subtask id on a task-level run instead of writing an empty or task-shaped one", () => {
    const command = buildRunCommand({
      agent: agentFixture(),
      prompt: "do the work",
      cwd: "/tmp/worktree",
      backlogDir: "/tmp/project/.backlog",
      env: { BACKLOG_RUN_ID: "run_1", BACKLOG_TASK_ID: "task_1", BACKLOG_TARGET_TYPE: "task" },
      getSecret: noSecrets,
      onActivity: () => {},
    });

    const config = JSON.parse(command.args[command.args.indexOf("--mcp-config") + 1]!) as {
      mcpServers: Record<string, { env: Record<string, string> }>;
    };
    expect(Object.keys(config.mcpServers.backlog?.env ?? {})).toEqual(["BACKLOG_RUN_ID", "BACKLOG_TASK_ID"]);
  });

  it("attaches a Stop hook to every run", () => {
    const command = buildRunCommand({
      agent: agentFixture(),
      prompt: "do the work",
      cwd: "/tmp/worktree",
      backlogDir: "/tmp/project/.backlog",
      env: {},
      getSecret: noSecrets,
      onActivity: () => {},
    });

    const settings = JSON.parse(command.args[command.args.indexOf("--settings") + 1] ?? "{}");
    expect(settings.hooks?.Stop?.[0]?.hooks?.[0]?.command).toContain("stop-hook");
  });
});
