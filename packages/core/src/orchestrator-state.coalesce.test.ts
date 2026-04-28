import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { initLayout } from "@backlog/config";
import { describe, expect, it } from "vitest";
import { updateOrchestratorState } from "./orchestrator-state.js";
import { readOrchestratorState } from "./state-files.js";

function realTmp(prefix: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function makeWorkspace(): string {
  const root = realTmp("backlog-orch-coalesce-");
  initLayout({ root, projectName: "orch-coalesce" });
  return path.join(root, ".backlog");
}

// Bring the on-disk last_tick_at to a known starting point and return its
// timestamp.
function seedTick(backlogDir: string, atIso: string): void {
  updateOrchestratorState(backlogDir, {
    mode: "running",
    max_agents: 2,
    auto_pick_agents: true,
    tick_interval_ms: 5000,
    started_at: "2026-04-28T10:00:00.000Z",
    last_tick_at: atIso,
    last_started_count: 0,
  });
}

describe("updateOrchestratorState heartbeat coalescing", () => {
  it("skips the disk write when only last_tick_at moved and the previous tick was less than 30s ago", () => {
    const backlogDir = makeWorkspace();
    const t0 = "2026-04-28T10:00:00.000Z";
    seedTick(backlogDir, t0);

    // Heartbeat-only update 5s later (typical tick).
    const t5 = "2026-04-28T10:00:05.000Z";
    updateOrchestratorState(backlogDir, { last_tick_at: t5 });

    // The disk file must still hold t0 — the in-memory return value
    // gets the new tick (callers see fresh data) but the file isn't
    // rewritten until the 30s threshold.
    expect(readOrchestratorState(backlogDir).last_tick_at).toBe(t0);
  });

  it("flushes when last_tick_at moves forward by ≥ 30s", () => {
    const backlogDir = makeWorkspace();
    const t0 = "2026-04-28T10:00:00.000Z";
    seedTick(backlogDir, t0);

    const t30 = "2026-04-28T10:00:30.000Z";
    updateOrchestratorState(backlogDir, { last_tick_at: t30 });

    expect(readOrchestratorState(backlogDir).last_tick_at).toBe(t30);
  });

  it("flushes when something other than last_tick_at also changed", () => {
    const backlogDir = makeWorkspace();
    const t0 = "2026-04-28T10:00:00.000Z";
    seedTick(backlogDir, t0);

    const t1 = "2026-04-28T10:00:01.000Z";
    updateOrchestratorState(backlogDir, {
      last_tick_at: t1,
      last_started_count: 3, // non-tick field forces the flush
    });

    const onDisk = readOrchestratorState(backlogDir);
    expect(onDisk.last_tick_at).toBe(t1);
    expect(onDisk.last_started_count).toBe(3);
  });

  it("flushes when mode changes (paused/stopped) regardless of tick recency", () => {
    const backlogDir = makeWorkspace();
    seedTick(backlogDir, "2026-04-28T10:00:00.000Z");

    updateOrchestratorState(backlogDir, {
      last_tick_at: "2026-04-28T10:00:02.000Z",
      mode: "paused",
    });

    expect(readOrchestratorState(backlogDir).mode).toBe("paused");
  });
});
