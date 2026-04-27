import { describe, expect, it } from "vitest";
import type { Run, SubTask } from "@backlog/schemas";
import { computeSubTaskProgress, computeTaskProgress, elapsedSeconds, etaIso } from "./progress.js";

function makeTask(overrides: Partial<SubTask> = {}): SubTask {
  return {
    id: "TASK-1",
    task_id: "WI-1",
    title: "Test",
    repo: "myrepo",
    status: "queued",
    priority_score: 50,
    risk: "medium",
    scopes: [],
    claim_mode: "exclusive",
    depends_on: [],
    blockers: [],
    execution: {
      preferred_agents: [],
      required_capabilities: [],
      manual_approval_required: false,
    },
    completion: { done_when: [] },
    planner: { origin: "manual", locked: false },
    created_at: "2026-04-26T10:00:00.000Z",
    updated_at: "2026-04-26T10:00:00.000Z",
    ...overrides,
  };
}

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    version: 1,
    id: "RUN-1",
    subtask_id: "TASK-1",
    task_id: "WI-1",
    repo: "myrepo",
    branch: "feat/x",
    agent_id: "agent-1",
    provider: "claude",
    status: "running",
    claim_ids: [],
    worktree_path: "/tmp/wt",
    artifacts: [],
    result: null,
    started_at: "2026-04-26T10:00:00.000Z",
    ...overrides,
  };
}

describe("computeSubTaskProgress", () => {
  it("uses agent-reported progress when present", () => {
    const task = makeTask({ progress_percent: 42, status: "running" });
    const run = makeRun();
    const result = computeSubTaskProgress({ task, activeRun: run, estimateSeconds: 600, now: Date.now() });
    expect(result.percent).toBe(42);
    expect(result.source).toBe("agent");
  });

  it("derives from elapsed/estimate when running", () => {
    const startedMs = Date.parse("2026-04-26T10:00:00.000Z");
    const task = makeTask({ status: "running" });
    const run = makeRun({ started_at: "2026-04-26T10:00:00.000Z" });
    const result = computeSubTaskProgress({
      task,
      activeRun: run,
      estimateSeconds: 600,
      now: startedMs + 300_000, // 5 min in
    });
    expect(result.percent).toBe(50);
    expect(result.source).toBe("elapsed");
    expect(result.elapsed_seconds).toBe(300);
  });

  it("caps elapsed-derived progress at 95% before completion", () => {
    const startedMs = Date.parse("2026-04-26T10:00:00.000Z");
    const task = makeTask({ status: "running" });
    const run = makeRun({ started_at: "2026-04-26T10:00:00.000Z" });
    const result = computeSubTaskProgress({
      task,
      activeRun: run,
      estimateSeconds: 60,
      now: startedMs + 120_000, // 2x the estimate
    });
    expect(result.percent).toBe(95);
    expect(result.source).toBe("elapsed");
  });

  it("uses status fallback when no run", () => {
    const task = makeTask({ status: "review" });
    const result = computeSubTaskProgress({ task, activeRun: null, estimateSeconds: 600 });
    expect(result.percent).toBe(90);
    expect(result.source).toBe("status");
  });

  it("returns 100 for completed", () => {
    const task = makeTask({ status: "completed" });
    const result = computeSubTaskProgress({ task, activeRun: null, estimateSeconds: 600 });
    expect(result.percent).toBe(100);
  });
});

describe("elapsedSeconds", () => {
  it("returns null when no run", () => {
    expect(elapsedSeconds(null, Date.now())).toBeNull();
  });

  it("uses finished_at when present", () => {
    const run = makeRun({
      started_at: "2026-04-26T10:00:00.000Z",
      finished_at: "2026-04-26T10:30:00.000Z",
      status: "succeeded",
    });
    expect(elapsedSeconds(run, Date.now())).toBe(1800);
  });

  it("uses now when run still active", () => {
    const startedMs = Date.parse("2026-04-26T10:00:00.000Z");
    const run = makeRun({ started_at: "2026-04-26T10:00:00.000Z" });
    expect(elapsedSeconds(run, startedMs + 600_000)).toBe(600);
  });
});

describe("etaIso", () => {
  it("returns started_at + estimate", () => {
    const run = makeRun({ started_at: "2026-04-26T10:00:00.000Z" });
    expect(etaIso(run, 600)).toBe("2026-04-26T10:10:00.000Z");
  });

  it("returns null when no run", () => {
    expect(etaIso(null, 600)).toBeNull();
  });
});

describe("computeTaskProgress", () => {
  it("returns 0 for empty list", () => {
    expect(computeTaskProgress({ taskProgresses: [] })).toBe(0);
  });

  it("weighs by duration", () => {
    const result = computeTaskProgress({
      taskProgresses: [
        { percent: 100, estimateSeconds: 600 },
        { percent: 0, estimateSeconds: 600 },
      ],
    });
    expect(result).toBe(50);
  });

  it("weights longer tasks more", () => {
    const result = computeTaskProgress({
      taskProgresses: [
        { percent: 100, estimateSeconds: 100 },
        { percent: 0, estimateSeconds: 900 },
      ],
    });
    expect(result).toBe(10);
  });
});
