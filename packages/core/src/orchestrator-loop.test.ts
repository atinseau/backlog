import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initLayout } from "@backlog/config";
import { git } from "@backlog/git";
import {
  hydrateOrchestrator,
  pauseOrchestrator,
  setOrchestratorConfig,
  shutdownOrchestrator,
  startOrchestrator,
  stopOrchestrator,
} from "./orchestrator-loop.js";
import { getOrchestratorState } from "./orchestrator-state.js";

async function createWorkspace(): Promise<string> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-loop-"));
  await git(["init", "-b", "main"], root);
  fs.writeFileSync(path.join(root, "README.md"), "# backlog\n", "utf8");
  await git(["add", "README.md"], root);
  await git(["-c", "user.name=Backlog", "-c", "user.email=backlog@example.com", "commit", "-m", "init"], root);
  initLayout({ root, projectName: "loop-test", mode: "embedded" });
  return path.join(root, ".backlog");
}

describe("orchestrator-loop", () => {
  let backlogDir: string;

  beforeEach(async () => {
    backlogDir = await createWorkspace();
  });

  afterEach(() => {
    shutdownOrchestrator(backlogDir);
  });

  it("start transitions to running and records started_at", async () => {
    const state = await startOrchestrator(backlogDir, {
      max_agents: 2,
      auto_pick_agents: false,
      tick_interval_ms: 60_000,
    });
    expect(state.mode).toBe("running");
    expect(state.max_agents).toBe(2);
    expect(state.auto_pick_agents).toBe(false);
    expect(state.started_at).toBeTruthy();
  });

  it("pause transitions to paused and records paused_at", async () => {
    await startOrchestrator(backlogDir, { tick_interval_ms: 60_000 });
    const paused = pauseOrchestrator(backlogDir);
    expect(paused.mode).toBe("paused");
    expect(paused.paused_at).toBeTruthy();
  });

  it("stop with no active runs returns to idle immediately", async () => {
    await startOrchestrator(backlogDir, { tick_interval_ms: 60_000 });
    const stopped = await stopOrchestrator(backlogDir);
    expect(stopped.mode).toBe("idle");
    expect(stopped.started_at).toBeUndefined();
    expect(stopped.paused_at).toBeUndefined();
  });

  it("setOrchestratorConfig updates fields without changing mode", async () => {
    await startOrchestrator(backlogDir, { tick_interval_ms: 60_000, max_agents: 1 });
    const updated = setOrchestratorConfig(backlogDir, { max_agents: 5, auto_pick_agents: false });
    expect(updated.max_agents).toBe(5);
    expect(updated.auto_pick_agents).toBe(false);
    expect(updated.mode).toBe("running");
  });

  it("hydrate with stale last_tick_at forces idle", async () => {
    await startOrchestrator(backlogDir, { tick_interval_ms: 60_000 });
    // simulate stale tick by overwriting last_tick_at to 10 minutes ago
    const stale = new Date(Date.now() - 10 * 60_000).toISOString();
    setOrchestratorConfig(backlogDir, {});
    fs.writeFileSync(
      path.join(backlogDir, "orchestrator.json"),
      JSON.stringify({ ...getOrchestratorState(backlogDir), last_tick_at: stale }, null, 2),
    );

    const hydrated = await hydrateOrchestrator(backlogDir);
    expect(hydrated.mode).toBe("idle");
    expect(hydrated.last_error).toBe("stale_hydrate");
  });

  it("hydrate with fresh last_tick_at keeps running", async () => {
    await startOrchestrator(backlogDir, { tick_interval_ms: 60_000 });
    // simulate fresh tick
    const fresh = new Date().toISOString();
    fs.writeFileSync(
      path.join(backlogDir, "orchestrator.json"),
      JSON.stringify({ ...getOrchestratorState(backlogDir), last_tick_at: fresh }, null, 2),
    );

    const hydrated = await hydrateOrchestrator(backlogDir);
    expect(hydrated.mode).toBe("running");
  });

  it("hydrate is a no-op when state is idle", async () => {
    const hydrated = await hydrateOrchestrator(backlogDir);
    expect(hydrated.mode).toBe("idle");
  });
});
