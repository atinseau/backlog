import { describe, expect, it } from "bun:test";
import { traceSchema } from "./trace.js";

const base = {
  version: 1 as const,
  run_id: "run_001",
  task_id: "task_001",
  created_at: "2026-08-17T10:00:00.000Z",
  summary: "Wired the reentrancy guard.",
};

describe("traceSchema", () => {
  it("accepts an implemented trace and defaults the collections", () => {
    const trace = traceSchema.parse({ ...base, outcome: "implemented" });
    expect(trace.constraints).toEqual([]);
    expect(trace.decisions).toEqual([]);
    expect(trace.discovered_deps).toEqual([]);
    expect(trace.consolidation_hint).toBe("none");
  });

  it("requires rejection_reason when the outcome is rejected", () => {
    expect(() => traceSchema.parse({ ...base, outcome: "rejected" })).toThrow(
      /rejection_reason/,
    );
    const trace = traceSchema.parse({
      ...base,
      outcome: "rejected",
      rejection_reason: "Already satisfied by task_003.",
    });
    expect(trace.outcome).toBe("rejected");
  });

  it("requires open_question when the outcome is blocked", () => {
    expect(() => traceSchema.parse({ ...base, outcome: "blocked" })).toThrow(
      /open_question/,
    );
  });

  it("requires evidence on every constraint", () => {
    expect(() =>
      traceSchema.parse({
        ...base,
        outcome: "implemented",
        constraints: [{ statement: "writers must be reentrant", confidence: "verified" }],
      }),
    ).toThrow();
  });

  it("accepts both shapes of discovered dependency", () => {
    const trace = traceSchema.parse({
      ...base,
      outcome: "implemented",
      discovered_deps: [
        { kind: "existing", task_id: "task_017" },
        { kind: "proposal", proposal: { title: "Split the store writer", motive: "Found while editing." } },
      ],
    });
    expect(trace.discovered_deps).toHaveLength(2);
    expect(trace.discovered_deps[1]!.kind).toBe("proposal");
  });

  it("requires a reason when the consolidation hint is high", () => {
    expect(() =>
      traceSchema.parse({ ...base, outcome: "implemented", consolidation_hint: "high" }),
    ).toThrow(/consolidation_hint_reason/);
  });
});
