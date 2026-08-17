import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "bun:test";
import type { Trace } from "@backlog/schemas";
import { appendTrace, listTraces, traceFilePath } from "./trace-store.js";

function trace(overrides: Partial<Trace> = {}): Trace {
  return {
    version: 1,
    run_id: "run_001",
    task_id: "task_001",
    created_at: "2026-08-17T10:00:00.000Z",
    outcome: "implemented",
    summary: "Did the thing.",
    constraints: [],
    decisions: [],
    discovered_deps: [],
    consolidation_hint: "none",
    ...overrides,
  } as Trace;
}

describe("trace-store", () => {
  let backlogDir: string;

  beforeEach(() => {
    backlogDir = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-trace-"));
  });

  it("creates the traces directory on first append", () => {
    appendTrace(backlogDir, trace());
    expect(fs.existsSync(path.join(backlogDir, "traces"))).toBe(true);
  });

  it("appends rather than replacing, keeping chronological order", () => {
    appendTrace(backlogDir, trace({ run_id: "run_001", summary: "first" }));
    appendTrace(backlogDir, trace({ run_id: "run_002", summary: "second" }));
    const traces = listTraces(backlogDir, "task_001");
    expect(traces.map((t) => t.summary)).toEqual(["first", "second"]);
  });

  it("keeps each task's traces in its own file", () => {
    appendTrace(backlogDir, trace({ task_id: "task_001" }));
    appendTrace(backlogDir, trace({ task_id: "task_002" }));
    expect(listTraces(backlogDir, "task_001")).toHaveLength(1);
    expect(listTraces(backlogDir, "task_002")).toHaveLength(1);
  });

  it("returns an empty list for a task with no traces", () => {
    expect(listTraces(backlogDir, "task_404")).toEqual([]);
  });

  it("skips an unparseable line instead of throwing", () => {
    appendTrace(backlogDir, trace());
    fs.appendFileSync(traceFilePath(backlogDir, "task_001"), "{ not json\n", "utf8");
    expect(listTraces(backlogDir, "task_001")).toHaveLength(1);
  });

  it("rejects a task id that would escape the traces directory", () => {
    expect(() => appendTrace(backlogDir, trace({ task_id: "../escape" }))).toThrow(
      /invalid task id/,
    );
  });
});
