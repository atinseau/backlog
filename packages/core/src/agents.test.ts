import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { initLayout } from "@cockpit-ai/config";
import { git } from "@cockpit-ai/git";
import { getAgent, selectionForAgentTask, setAgentEnabled, updateAgent, validateAgents } from "./agents.js";
import { createTask } from "./task-service.js";
import { createWorkItem } from "./work-service.js";

async function createWorkspace(): Promise<string> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cockpit-agents-"));
  await git(["init", "-b", "main"], root);
  fs.writeFileSync(path.join(root, "README.md"), "# cockpit\n", "utf8");
  await git(["add", "README.md"], root);
  await git(["-c", "user.name=Cockpit", "-c", "user.email=cockpit@example.com", "commit", "-m", "init"], root);
  initLayout({
    root,
    workspaceName: "agents-test",
    mode: "embedded",
    repos: [
      {
        id: "cockpit",
        path: root,
        default_branch: "main",
        enabled: true,
      },
    ],
  });
  return root;
}

describe("agents", () => {
  let cockpitDir: string;

  beforeEach(async () => {
    cockpitDir = path.join(await createWorkspace(), ".cockpit");
  });

  it("updates mutable agent fields", () => {
    const updated = updateAgent(cockpitDir, "codex-default", {
      model: "gpt-5.4-mini",
      profile: "default",
      command: "/tmp/fake-codex",
      sandboxMode: "danger-full-access",
      successMode: "complete",
      maxConcurrentRuns: 2,
      allowedRepos: ["cockpit"],
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
    expect(updated.allowed_repos).toEqual(["cockpit"]);
    expect(updated.allowed_risk).toEqual(["low", "medium", "high"]);
    expect(updated.capabilities).toEqual(["plan", "edit_code"]);
    expect(updated.environment).toEqual({ OPENAI_API_KEY: "test" });
  });

  it("can enable and disable seeded agents", () => {
    expect(getAgent(cockpitDir, "claude-default")?.enabled).toBe(false);
    setAgentEnabled(cockpitDir, "claude-default", true);
    expect(getAgent(cockpitDir, "claude-default")?.enabled).toBe(true);
    setAgentEnabled(cockpitDir, "claude-default", false);
    expect(getAgent(cockpitDir, "claude-default")?.enabled).toBe(false);
  });

  it("keeps validation working after an agent update", () => {
    updateAgent(cockpitDir, "manual-default", {
      capabilities: ["plan", "review"],
      allowedRisk: ["low"],
      enabled: true,
    });

    const validation = validateAgents(cockpitDir).find((result) => result.id === "manual-default");
    expect(validation?.ok).toBe(true);
  });

  it("explains why a forced agent is unavailable for one task", () => {
    const workItem = createWorkItem(cockpitDir, { title: "Agent targeting", repoTargets: ["cockpit"] });
    const task = createTask(cockpitDir, {
      workItemId: workItem.id,
      title: "Run with codex",
      repo: "cockpit",
      risk: "low",
      requiredCapabilities: ["edit_code"],
    });

    const selection = selectionForAgentTask(cockpitDir, task, "codex-default");
    expect(selection?.available).toBe(false);
    expect(selection?.reasons).toContain("disabled");
  });
});
