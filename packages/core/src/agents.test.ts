import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";
import { initLayout } from "@backlog/config";
import { git } from "@backlog/git";
import {
  ensureDefaultModelAgents,
  getAgent,
  readAgentsFile,
  selectionForAgentTask,
  setAgentEnabled,
  updateAgent,
  validateAgents,
  writeAgentsFile,
} from "./agents.js";
import { createSubTask } from "./subtask-service.js";
import { createTask } from "./task-service.js";

async function createWorkspace(): Promise<string> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-agents-"));
  await git(["init", "-b", "main"], root);
  fs.writeFileSync(path.join(root, "README.md"), "# backlog\n", "utf8");
  await git(["add", "README.md"], root);
  await git(["-c", "user.name=Backlog", "-c", "user.email=backlog@example.com", "commit", "-m", "init"], root);
  initLayout({
    root,
    projectName: "agents-test",
    mode: "embedded",
    repos: [
      {
        id: "backlog",
        path: root,
        default_branch: "main",
        enabled: true,
      },
    ],
  });
  return root;
}

describe("agents", () => {
  let backlogDir: string;

  beforeEach(async () => {
    backlogDir = path.join(await createWorkspace(), ".backlog");
  });

  it("updates mutable agent fields", () => {
    const updated = updateAgent(backlogDir, "claude-opus", {
      model: "opus-mini",
      profile: "default",
      command: "/tmp/fake-claude",
      successMode: "complete",
      maxConcurrentRuns: 2,
      allowedRepos: ["backlog"],
      allowedRisk: ["low", "medium", "high"],
      capabilities: ["plan", "edit_code"],
      environment: {
        ANTHROPIC_API_KEY: "test",
      },
      enabled: true,
    });

    expect(updated.enabled).toBe(true);
    expect(updated.model).toBe("opus-mini");
    expect(updated.profile).toBe("default");
    expect(updated.command).toBe("/tmp/fake-claude");
    expect(updated.success_mode).toBe("complete");
    expect(updated.max_concurrent_runs).toBe(2);
    expect(updated.allowed_repos).toEqual(["backlog"]);
    expect(updated.allowed_risk).toEqual(["low", "medium", "high"]);
    expect(updated.capabilities).toEqual(["plan", "edit_code"]);
    expect(updated.environment).toEqual({ ANTHROPIC_API_KEY: "test" });
  });

  it("can enable and disable seeded agents", () => {
    // All default agents are seeded enabled now that Codex (the one
    // seeded disabled, so the user picked claude by default) is gone.
    // Toggle one off then on to exercise both transitions cleanly.
    expect(getAgent(backlogDir, "claude-haiku")?.enabled).toBe(true);
    setAgentEnabled(backlogDir, "claude-haiku", false);
    expect(getAgent(backlogDir, "claude-haiku")?.enabled).toBe(false);
    setAgentEnabled(backlogDir, "claude-haiku", true);
    expect(getAgent(backlogDir, "claude-haiku")?.enabled).toBe(true);
  });

  it("backfills default model variants for projects with the old seed set", () => {
    fs.writeFileSync(
      path.join(backlogDir, "agents.yaml"),
      [
        "version: 1",
        "agents:",
        "  - id: claude-code",
        "    provider: claude",
        "    model: sonnet",
        "    enabled: true",
        "    max_concurrent_runs: 1",
        "    allowed_repos: []",
        "    allowed_risk: [low, medium]",
        "    capabilities: [plan, edit_code, run_tests, review, shell, git_read, git_write]",
        "    environment: {}",
        "  - id: codex",
        "    provider: codex",
        "    model: gpt-5-codex",
        "    enabled: false",
        "    max_concurrent_runs: 1",
        "    allowed_repos: []",
        "    allowed_risk: [low, medium]",
        "    capabilities: [plan, edit_code, run_tests, review, shell, git_read, git_write]",
        "    environment: {}",
        "",
      ].join("\n"),
      "utf8",
    );

    // This fixture is old on-disk state from before Codex was removed as a
    // runtime — the migration still recognises this exact pair by id (see
    // the comment on ensureDefaultModelAgents) and inserts the new variants
    // ahead of the old codex position, same as it always has.
    const upgraded = ensureDefaultModelAgents(backlogDir);
    expect(upgraded.agents.map((agent) => agent.id)).toEqual([
      "claude-code",
      "claude-opus",
      "claude-haiku",
      "codex",
    ]);
    expect(upgraded.agents.find((agent) => agent.id === "codex")?.model).toBe("gpt-5.5");
    expect(ensureDefaultModelAgents(backlogDir).agents).toHaveLength(4);
  });

  it("does not backfill Opus/Haiku for a two-agent project that isn't the old codex-shaped default", () => {
    // Regression guard: a user who deleted the seeded Codex agent and added
    // one custom agent of their own ends up with exactly 2 agents, one of
    // them claude-code — but it is NOT the legacy `claude-code` + `codex`
    // shape, so ensureDefaultModelAgents must leave it alone. This fails if
    // the `ids.has("codex")` term is ever dropped from the check again.
    fs.writeFileSync(
      path.join(backlogDir, "agents.yaml"),
      [
        "version: 1",
        "agents:",
        "  - id: claude-code",
        "    provider: claude",
        "    model: sonnet",
        "    enabled: true",
        "    max_concurrent_runs: 1",
        "    allowed_repos: []",
        "    allowed_risk: [low, medium]",
        "    capabilities: [plan, edit_code, run_tests, review, shell, git_read, git_write]",
        "    environment: {}",
        "  - id: my-custom-agent",
        "    provider: custom",
        "    command: /usr/local/bin/my-agent",
        "    enabled: true",
        "    max_concurrent_runs: 1",
        "    allowed_repos: []",
        "    allowed_risk: [low, medium]",
        "    capabilities: [plan, edit_code, run_tests, review, shell, git_read, git_write]",
        "    environment: {}",
        "",
      ].join("\n"),
      "utf8",
    );

    const upgraded = ensureDefaultModelAgents(backlogDir);
    expect(upgraded.agents.map((agent) => agent.id)).toEqual(["claude-code", "my-custom-agent"]);
  });

  it("migrates legacy Codex default ids to the current bundled model", () => {
    fs.writeFileSync(
      path.join(backlogDir, "agents.yaml"),
      [
        "version: 1",
        "agents:",
        "  - id: codex-default",
        "    provider: codex",
        "    model: gpt-5-codex",
        "    enabled: false",
        "    max_concurrent_runs: 1",
        "    allowed_repos: []",
        "    allowed_risk: [low, medium]",
        "    capabilities: [plan, edit_code, run_tests, review, shell, git_read, git_write]",
        "    environment: {}",
        "  - id: claude-default",
        "    provider: claude",
        "    model: sonnet",
        "    enabled: true",
        "    max_concurrent_runs: 1",
        "    allowed_repos: []",
        "    allowed_risk: [low, medium]",
        "    capabilities: [plan, edit_code, review]",
        "    environment: {}",
        "",
      ].join("\n"),
      "utf8",
    );

    const upgraded = ensureDefaultModelAgents(backlogDir);
    expect(upgraded.agents.find((agent) => agent.id === "codex-default")?.model).toBe("gpt-5.5");
    expect(ensureDefaultModelAgents(backlogDir).agents).toHaveLength(2);
  });

  it("keeps validation working after an agent update", () => {
    // validateAgents checks executableExists(agent.command ?? "claude").
    // CI runners don't have `claude` on PATH, so without a real command
    // the test passes only on dev machines where the user actually has
    // Claude installed. process.execPath is always present (it's the
    // running node binary) — use it as a stand-in.
    updateAgent(backlogDir, "claude-code", {
      capabilities: ["plan", "review"],
      allowedRisk: ["low"],
      command: process.execPath,
      enabled: true,
    });

    const validation = validateAgents(backlogDir).find((result) => result.id === "claude-code");
    expect(validation?.ok).toBe(true);
  });

  it("schedules a Claude agent with no API key, because the CLI carries its own session", () => {
    // The binary has to exist for the agent to be runnable at all; what this
    // asserts is that no ANTHROPIC_API_KEY is required on top of it.
    updateAgent(backlogDir, "claude-code", { command: process.execPath });
    const workItem = createTask(backlogDir, { title: "Subscription run", repoTargets: ["backlog"] });
    const task = createSubTask(backlogDir, {
      workItemId: workItem.id,
      title: "Run on the plan",
      repo: "backlog",
      risk: "low",
    });

    const selection = selectionForAgentTask(backlogDir, task, "claude-code");

    expect(selection?.available).toBe(true);
    expect(selection?.reasons).not.toContain("missing_api_key:ANTHROPIC_API_KEY");
  });

  it("blocks a Claude agent pinned to api_key until the key is stored", () => {
    updateAgent(backlogDir, "claude-code", { command: process.execPath, authMode: "api_key" });
    const workItem = createTask(backlogDir, { title: "Pinned run", repoTargets: ["backlog"] });
    const task = createSubTask(backlogDir, {
      workItemId: workItem.id,
      title: "Run on a key",
      repo: "backlog",
      risk: "low",
    });

    const selection = selectionForAgentTask(backlogDir, task, "claude-code");

    expect(selection?.available).toBe(false);
    expect(selection?.reasons).toContain("missing_api_key:ANTHROPIC_API_KEY");
  });

  it("names the missing executable rather than the provider", () => {
    updateAgent(backlogDir, "claude-code", { command: "/nowhere/claude" });
    const workItem = createTask(backlogDir, { title: "Missing binary", repoTargets: ["backlog"] });
    const task = createSubTask(backlogDir, {
      workItemId: workItem.id,
      title: "Run without a binary",
      repo: "backlog",
      risk: "low",
    });

    const selection = selectionForAgentTask(backlogDir, task, "claude-code");

    expect(selection?.reasons).toContain("missing_executable:/nowhere/claude");
  });

  it("explains why a forced agent is unavailable for one task", () => {
    // Simulate a project whose agents.yaml still carries a pre-removal
    // Codex agent on disk (addAgent itself refuses "codex" now — see
    // registry.test.ts — so this writes the legacy shape directly).
    const file = readAgentsFile(backlogDir);
    file.agents.push({
      id: "legacy-codex",
      provider: "codex",
      enabled: true,
      max_concurrent_runs: 1,
      allowed_repos: [],
      allowed_risk: ["low", "medium"],
      capabilities: ["plan", "edit_code", "run_tests", "review", "shell", "git_read", "git_write"],
      environment: {},
      retry_policy: { mode: "none", max_attempts: 2, reuse_worktree: true },
    });
    writeAgentsFile(backlogDir, file);

    const workItem = createTask(backlogDir, { title: "Agent targeting", repoTargets: ["backlog"] });
    const task = createSubTask(backlogDir, {
      workItemId: workItem.id,
      title: "Run with a removed provider",
      repo: "backlog",
      risk: "low",
      requiredCapabilities: ["edit_code"],
    });

    const selection = selectionForAgentTask(backlogDir, task, "legacy-codex");
    // The provider no longer resolves, so the agent is unavailable —
    // same fallback a made-up provider id would get.
    expect(selection?.available).toBe(false);
    expect(selection?.reasons).toContain("unsupported_provider:codex");
  });
});
