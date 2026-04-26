import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { initLayout } from "@backlog/config";
import { git } from "@backlog/git";
import { getOrchestratorState, updateOrchestratorState } from "./orchestrator-state.js";

async function createWorkspace(): Promise<string> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-orch-"));
  await git(["init", "-b", "main"], root);
  fs.writeFileSync(path.join(root, "README.md"), "# backlog\n", "utf8");
  await git(["add", "README.md"], root);
  await git(["-c", "user.name=Backlog", "-c", "user.email=backlog@example.com", "commit", "-m", "init"], root);
  initLayout({ root, workspaceName: "orch-test", mode: "embedded" });
  return path.join(root, ".backlog");
}

describe("orchestrator-state", () => {
  let backlogDir: string;

  beforeEach(async () => {
    backlogDir = await createWorkspace();
  });

  it("returns defaults when file is absent", () => {
    const state = getOrchestratorState(backlogDir);
    expect(state.mode).toBe("idle");
    expect(state.max_agents).toBe(3);
    expect(state.auto_pick_agents).toBe(true);
    expect(state.tick_interval_ms).toBe(5000);
  });

  it("persists mode and config changes", () => {
    const updated = updateOrchestratorState(backlogDir, {
      mode: "running",
      max_agents: 7,
      auto_pick_agents: false,
      project_id: "PROJ-abc",
      started_at: "2026-04-26T10:00:00.000Z",
    });
    expect(updated.mode).toBe("running");
    expect(updated.max_agents).toBe(7);
    expect(updated.project_id).toBe("PROJ-abc");

    const reloaded = getOrchestratorState(backlogDir);
    expect(reloaded).toEqual(updated);
  });

  it("supports clearing optional fields with null", () => {
    updateOrchestratorState(backlogDir, {
      mode: "running",
      project_id: "PROJ-abc",
      started_at: "2026-04-26T10:00:00.000Z",
    });
    const cleared = updateOrchestratorState(backlogDir, {
      mode: "idle",
      project_id: null,
      started_at: null,
    });
    expect(cleared.project_id).toBeUndefined();
    expect(cleared.started_at).toBeUndefined();
  });
});
