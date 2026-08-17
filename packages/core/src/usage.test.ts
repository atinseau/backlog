import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "bun:test";
import { aggregateUsage, aggregateUsageByBucket, estimateRunCost, recordUsage } from "./usage.js";

function makeBacklogWithRun(runId: string): string {
  const backlogDir = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-usage-"));
  const runDir = path.join(backlogDir, "runs", "active", runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "events.ndjson"), "", "utf8");
  return backlogDir;
}

describe("recordUsage / aggregateUsage", () => {
  it("appends a usage event to the run's events.ndjson and aggregates token counts", () => {
    const backlogDir = makeBacklogWithRun("RUN-1");
    recordUsage(backlogDir, "RUN-1", {
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      input_tokens: 1_000_000,
      output_tokens: 500_000,
    });

    const result = aggregateUsage(backlogDir);
    expect(result.totals.input_tokens).toBe(1_000_000);
    expect(result.totals.output_tokens).toBe(500_000);
    // Sonnet 4.6 list price: $3/MM in + $15/MM out = $3 + $7.5 = $10.5
    expect(result.totals.cost_usd).toBeCloseTo(10.5, 4);
    expect(result.runs).toHaveLength(1);
    expect(result.runs[0]!.runId).toBe("RUN-1");
  });

  it("prices cache_read at 10% of input and cache_creation at 125% of input by default", () => {
    const backlogDir = makeBacklogWithRun("RUN-2");
    recordUsage(backlogDir, "RUN-2", {
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 1_000_000, // 10% of $3 = $0.30
      cache_creation_input_tokens: 1_000_000, // 125% of $3 = $3.75
    });

    const totals = aggregateUsage(backlogDir).totals;
    expect(totals.cost_usd).toBeCloseTo(0.3 + 3.75, 4);
    expect(totals.cache_read_input_tokens).toBe(1_000_000);
    expect(totals.cache_creation_input_tokens).toBe(1_000_000);
  });

  it("treats unknown models as $0 and accumulates them in unknown_model_tokens", () => {
    const backlogDir = makeBacklogWithRun("RUN-3");
    recordUsage(backlogDir, "RUN-3", {
      provider: "custom",
      model: "totally-made-up-model",
      input_tokens: 100,
      output_tokens: 50,
    });
    const totals = aggregateUsage(backlogDir).totals;
    expect(totals.cost_usd).toBe(0);
    expect(totals.unknown_model_tokens).toBe(150);
  });

  it("groups by model across multiple runs and applies --since cutoffs", () => {
    const backlogDir = makeBacklogWithRun("RUN-A");
    fs.mkdirSync(path.join(backlogDir, "runs", "active", "RUN-B"), { recursive: true });
    fs.writeFileSync(path.join(backlogDir, "runs", "active", "RUN-B", "events.ndjson"), "", "utf8");

    // Old event (before cutoff)
    recordUsage(backlogDir, "RUN-A", {
      provider: "anthropic",
      model: "claude-haiku-4-5",
      input_tokens: 100_000,
      output_tokens: 50_000,
      ts: "2026-01-01T00:00:00.000Z",
    });
    // New events (after cutoff)
    recordUsage(backlogDir, "RUN-A", {
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      input_tokens: 200_000,
      output_tokens: 100_000,
      ts: "2026-04-28T00:00:00.000Z",
    });
    recordUsage(backlogDir, "RUN-B", {
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      input_tokens: 50_000,
      output_tokens: 25_000,
      ts: "2026-04-28T01:00:00.000Z",
    });

    const cutoff = aggregateUsage(backlogDir, { sinceIso: "2026-02-01T00:00:00.000Z" });
    // Only the post-cutoff events count.
    expect(cutoff.totals.input_tokens).toBe(250_000);
    expect(cutoff.totals.output_tokens).toBe(125_000);
    expect(Object.keys(cutoff.perModel)).toEqual(["claude-sonnet-4-6"]);
    expect(cutoff.runs.map((r) => r.runId).sort()).toEqual(["RUN-A", "RUN-B"]);

    // Without cutoff, both models present.
    const all = aggregateUsage(backlogDir);
    expect(Object.keys(all.perModel).sort()).toEqual(["claude-haiku-4-5", "claude-sonnet-4-6"]);
  });

  it("ignores non-usage event lines and malformed JSON", () => {
    const backlogDir = makeBacklogWithRun("RUN-X");
    const eventsPath = path.join(backlogDir, "runs", "active", "RUN-X", "events.ndjson");
    fs.appendFileSync(eventsPath, JSON.stringify({ type: "run.created", message: "hi" }) + "\n", "utf8");
    fs.appendFileSync(eventsPath, "{ this isn't json\n", "utf8");
    recordUsage(backlogDir, "RUN-X", {
      provider: "anthropic",
      model: "claude-opus-4-1",
      input_tokens: 10,
      output_tokens: 5,
    });

    const totals = aggregateUsage(backlogDir).totals;
    // Opus 4.1 = $15/MM input, $75/MM output → 10×15/MM + 5×75/MM
    expect(totals.cost_usd).toBeCloseTo((10 * 15 + 5 * 75) / 1_000_000, 8);
  });
});

describe("aggregateUsageByBucket", () => {
  it("groups events into day buckets in chronological order", () => {
    const backlogDir = makeBacklogWithRun("RUN-day");
    recordUsage(backlogDir, "RUN-day", {
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      input_tokens: 100_000,
      output_tokens: 50_000,
      ts: "2026-04-26T08:00:00.000Z",
    });
    recordUsage(backlogDir, "RUN-day", {
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      input_tokens: 200_000,
      output_tokens: 100_000,
      ts: "2026-04-28T10:00:00.000Z",
    });
    recordUsage(backlogDir, "RUN-day", {
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      input_tokens: 50_000,
      output_tokens: 25_000,
      ts: "2026-04-28T18:00:00.000Z",
    });

    const series = aggregateUsageByBucket(backlogDir, "day");
    expect(series.map((s) => s.bucket)).toEqual(["2026-04-26", "2026-04-28"]);
    // Same-day events sum together.
    expect(series[1]!.totals.input_tokens).toBe(250_000);
    expect(series[1]!.totals.output_tokens).toBe(125_000);
  });

  it("groups by month with YYYY-MM keys", () => {
    const backlogDir = makeBacklogWithRun("RUN-month");
    for (const ts of ["2026-03-01T00:00:00.000Z", "2026-04-01T00:00:00.000Z", "2026-04-30T23:00:00.000Z"]) {
      recordUsage(backlogDir, "RUN-month", {
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        input_tokens: 1000,
        output_tokens: 500,
        ts,
      });
    }
    const series = aggregateUsageByBucket(backlogDir, "month");
    expect(series.map((s) => s.bucket)).toEqual(["2026-03", "2026-04"]);
    expect(series[1]!.totals.input_tokens).toBe(2000);
  });

  it("respects --since by filtering older events out before bucketing", () => {
    const backlogDir = makeBacklogWithRun("RUN-since");
    recordUsage(backlogDir, "RUN-since", {
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      input_tokens: 1000,
      output_tokens: 500,
      ts: "2026-01-01T00:00:00.000Z",
    });
    recordUsage(backlogDir, "RUN-since", {
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      input_tokens: 2000,
      output_tokens: 1000,
      ts: "2026-04-15T00:00:00.000Z",
    });

    const filtered = aggregateUsageByBucket(backlogDir, "month", {
      sinceIso: "2026-04-01T00:00:00.000Z",
    });
    expect(filtered.map((s) => s.bucket)).toEqual(["2026-04"]);
    expect(filtered[0]!.totals.input_tokens).toBe(2000);
  });
});

describe("estimateRunCost", () => {
  function seedRun(backlogDir: string, runId: string, run: Record<string, unknown>): void {
    const dir = path.join(backlogDir, "runs", "active", runId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "events.ndjson"), "", "utf8");
    fs.writeFileSync(path.join(dir, "run.json"), JSON.stringify(run), "utf8");
  }

  it("returns null when fewer than 3 matching past runs exist", () => {
    const backlogDir = makeBacklogWithRun("RUN-only");
    recordUsage(backlogDir, "RUN-only", {
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      input_tokens: 1000,
      output_tokens: 500,
    });
    expect(estimateRunCost(backlogDir)).toBeNull();
  });

  it("returns the median cost across matching runs", () => {
    const backlogDir = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-estimate-"));
    for (let i = 0; i < 5; i++) {
      const id = `RUN-${i}`;
      seedRun(backlogDir, id, { id, repo: "alpha", agent_id: "claude-default" });
      // Costs: $10, $20, $30, $40, $50 → median = $30
      recordUsage(backlogDir, id, {
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        input_tokens: (i + 1) * 1_000_000, // i+1 M tokens × $3/M = $(i+1)*3 in
        output_tokens: ((i + 1) * 1_000_000) / 3, // → +$(i+1)*5 out
      });
    }
    const estimate = estimateRunCost(backlogDir);
    expect(estimate).not.toBeNull();
    expect(estimate!.sample_size).toBe(5);
    // $3/MM in × 3MM tokens = $9 + $15/MM out × 1MM tokens = $15 → $24 for the median run
    expect(estimate!.cost_usd).toBeCloseTo(24, 4);
  });

  it("filters by repo: only runs for that repo are counted", () => {
    const backlogDir = fs.mkdtempSync(path.join(os.tmpdir(), "backlog-est-repo-"));
    // 3 alpha runs at cheap pricing
    for (let i = 0; i < 3; i++) {
      seedRun(backlogDir, `A-${i}`, { id: `A-${i}`, repo: "alpha", agent_id: "x" });
      recordUsage(backlogDir, `A-${i}`, {
        provider: "anthropic",
        model: "claude-haiku-4-5",
        input_tokens: 100_000,
        output_tokens: 50_000,
      });
    }
    // 3 beta runs at expensive pricing — should NOT be considered when --repo=alpha
    for (let i = 0; i < 3; i++) {
      seedRun(backlogDir, `B-${i}`, { id: `B-${i}`, repo: "beta", agent_id: "x" });
      recordUsage(backlogDir, `B-${i}`, {
        provider: "anthropic",
        model: "claude-opus-4-1",
        input_tokens: 1_000_000,
        output_tokens: 1_000_000,
      });
    }
    const alpha = estimateRunCost(backlogDir, { repo: "alpha" })!;
    expect(alpha.sample_size).toBe(3);
    // haiku 4.5: 100K×$1/MM + 50K×$5/MM = $0.10 + $0.25 = $0.35
    expect(alpha.cost_usd).toBeCloseTo(0.35, 4);

    const beta = estimateRunCost(backlogDir, { repo: "beta" })!;
    expect(beta.cost_usd).toBeCloseTo(15 + 75, 1); // 1MM in + 1MM out at opus rates
  });
});
