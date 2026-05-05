import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { initLayout } from "@backlog/config";
import { git } from "@backlog/git";
import { ensureDefaultModelAgents, getAgent, selectionForAgentTask, setAgentEnabled, updateAgent, validateAgents } from "./agents.js";
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
    const updated = updateAgent(backlogDir, "codex", {
      model: "gpt-5.4-mini",
      profile: "default",
      command: "/tmp/fake-codex",
      sandboxMode: "danger-full-access",
      successMode: "complete",
      maxConcurrentRuns: 2,
      allowedRepos: ["backlog"],
      allowedRisk: ["low", "medium", "high"],
      capabilities: ["plan", "edit_code"],
      environment: {
        OPENAI_API_KEY: "test",
      },
      enabled: true,
    });

    expect(updated.enabled).toBe(true);
    expect(updated.model).toBe("gpt-5.4-mini");
    expect(updated.profile).toBe("default");
    expect(updated.command).toBe("/tmp/fake-codex");
    expect(updated.sandbox_mode).toBe("danger-full-access");
    expect(updated.success_mode).toBe("complete");
    expect(updated.max_concurrent_runs).toBe(2);
    expect(updated.allowed_repos).toEqual(["backlog"]);
    expect(updated.allowed_risk).toEqual(["low", "medium", "high"]);
    expect(updated.capabilities).toEqual(["plan", "edit_code"]);
    expect(updated.environment).toEqual({ OPENAI_API_KEY: "test" });
  });

  it("can enable and disable seeded agents", () => {
    // codex is seeded disabled (so the user picks claude by default).
    // Toggle it on then off to exercise both transitions cleanly.
    expect(getAgent(backlogDir, "codex")?.enabled).toBe(false);
    setAgentEnabled(backlogDir, "codex", true);
    expect(getAgent(backlogDir, "codex")?.enabled).toBe(true);
    setAgentEnabled(backlogDir, "codex", false);
    expect(getAgent(backlogDir, "codex")?.enabled).toBe(false);
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

    const upgraded = ensureDefaultModelAgents(backlogDir);
    expect(upgraded.agents.map((agent) => agent.id)).toEqual([
      "claude-code",
      "claude-opus",
      "claude-haiku",
      "codex",
    ]);
    expect(ensureDefaultModelAgents(backlogDir).agents).toHaveLength(4);
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

  it("explains why a forced agent is unavailable for one task", () => {
    const workItem = createTask(backlogDir, { title: "Agent targeting", repoTargets: ["backlog"] });
    const task = createSubTask(backlogDir, {
      workItemId: workItem.id,
      title: "Run with codex",
      repo: "backlog",
      risk: "low",
      requiredCapabilities: ["edit_code"],
    });

    const selection = selectionForAgentTask(backlogDir, task, "codex");
    // codex is seeded without an OPENAI_API_KEY in the workspace
    // secrets store, so the planner refuses to schedule it. The
    // "disabled" reason was retired alongside the enabled toggle.
    expect(selection?.available).toBe(false);
    expect(selection?.reasons).toContain("missing_api_key:OPENAI_API_KEY");
  });
});
