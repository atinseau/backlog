import fs from "node:fs";
import path from "node:path";

// Usage tracking for agent runs. Each provider (Anthropic, OpenAI/Codex,
// custom) emits per-call token counts in its API response — the executor
// is responsible for forwarding those into the run's events.ndjson via
// recordUsage(), and `backlog runs cost` aggregates them.
//
// We never store provider-side cost figures: pricing changes constantly
// and we don't want stale numbers in the audit trail. Instead we keep
// the raw token counts forever, and apply the pricing table at report
// time. Update the table when pricing moves.

export type UsageProvider = "anthropic" | "openai" | "codex" | "custom";

export interface UsageEvent {
  ts: string; // ISO timestamp
  type: "usage"; // discriminator inside events.ndjson
  message?: string;
  provider: UsageProvider;
  model: string; // e.g. "claude-sonnet-4-20250514", "gpt-5"
  // Counts in tokens. Cache_read = served from prompt cache (cheap).
  // cache_creation = the first call that populates the cache (premium).
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

function formatTokenCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function usageMessage(event: Omit<UsageEvent, "type" | "ts" | "message">): string {
  const total = event.input_tokens
    + event.output_tokens
    + (event.cache_read_input_tokens ?? 0)
    + (event.cache_creation_input_tokens ?? 0);
  const cacheBits: string[] = [];
  if (event.cache_read_input_tokens) cacheBits.push(`cache read ${formatTokenCount(event.cache_read_input_tokens)}`);
  if (event.cache_creation_input_tokens) cacheBits.push(`cache write ${formatTokenCount(event.cache_creation_input_tokens)}`);
  const cache = cacheBits.length > 0 ? ` · ${cacheBits.join(" · ")}` : "";
  return `${event.provider} ${event.model} · ${formatTokenCount(total)} tokens · input ${formatTokenCount(event.input_tokens)} · output ${formatTokenCount(event.output_tokens)}${cache}`;
}

// USD per 1 million tokens. Update when published prices move.
// Numbers below are the public list prices for early 2026.
interface ModelPricing {
  input: number;
  output: number;
  // Defaults: cache_read = 10% of input, cache_creation = 125% of input
  // (matches Anthropic's documented multipliers). Override per model
  // if a provider deviates.
  cache_read?: number;
  cache_creation?: number;
}

const PRICING_PER_MILLION: Record<string, ModelPricing> = {
  // Anthropic
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-opus-4-1": { input: 15, output: 75 },
  "claude-opus-4-5": { input: 15, output: 75 },
  "claude-opus-4": { input: 15, output: 75 },
  "claude-sonnet-4-5": { input: 3, output: 15 },
  "claude-sonnet-4": { input: 3, output: 15 },
  "claude-3-5-haiku": { input: 0.8, output: 4 },
  // OpenAI / Codex
  "gpt-5.5": { input: 5, output: 30 },
  "gpt-5.4-mini": { input: 0.75, output: 4.5 },
  "gpt-5.4": { input: 2.5, output: 15 },
  "gpt-5-codex": { input: 1.25, output: 10 },
  "gpt-5": { input: 1.25, output: 10 },
  "gpt-5-mini": { input: 0.15, output: 0.6 },
};

const PRICING_MODEL_ALIASES: Record<string, string> = {
  sonnet: "claude-sonnet-4-6",
  opus: "claude-opus-4-7",
  haiku: "claude-haiku-4-5",
  "claude-haiku-4-5-20251001": "claude-haiku-4-5",
  "claude-sonnet-4-5": "claude-sonnet-4-6",
  "claude-sonnet-4-20250514": "claude-sonnet-4",
  "claude-opus-4-1-20250805": "claude-opus-4-1",
  "claude-3-5-haiku-20241022": "claude-3-5-haiku",
};

function pricingFor(model: string): ModelPricing | null {
  // Tolerate vendor-prefixed slugs ("anthropic/claude-…") and date suffixes.
  const raw = model.toLowerCase().replace(/^[^/]+\//, "").replace(/-\d{8}$/, "");
  const normalized = PRICING_MODEL_ALIASES[raw] ?? raw;
  for (const [key, value] of Object.entries(PRICING_PER_MILLION)) {
    if (normalized.startsWith(key)) return value;
  }
  return null;
}

export interface UsageTotals {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  cost_usd: number; // null inputs (unknown model) are treated as $0
  unknown_model_tokens: number;
}

function emptyTotals(): UsageTotals {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    cost_usd: 0,
    unknown_model_tokens: 0,
  };
}

function add(totals: UsageTotals, event: UsageEvent): void {
  totals.input_tokens += event.input_tokens;
  totals.output_tokens += event.output_tokens;
  totals.cache_read_input_tokens += event.cache_read_input_tokens ?? 0;
  totals.cache_creation_input_tokens += event.cache_creation_input_tokens ?? 0;

  const pricing = pricingFor(event.model);
  if (!pricing) {
    totals.unknown_model_tokens += event.input_tokens + event.output_tokens;
    return;
  }
  const cacheReadRate = pricing.cache_read ?? pricing.input * 0.1;
  const cacheCreationRate = pricing.cache_creation ?? pricing.input * 1.25;
  const cost =
    (event.input_tokens / 1_000_000) * pricing.input +
    (event.output_tokens / 1_000_000) * pricing.output +
    ((event.cache_read_input_tokens ?? 0) / 1_000_000) * cacheReadRate +
    ((event.cache_creation_input_tokens ?? 0) / 1_000_000) * cacheCreationRate;
  totals.cost_usd += cost;
}

function activeRunsDir(backlogDir: string): string {
  return path.join(backlogDir, "runs", "active");
}

function archiveRunsDir(backlogDir: string): string {
  return path.join(backlogDir, "runs", "archive");
}

function eventsPath(backlogDir: string, runId: string): string | null {
  for (const dir of [activeRunsDir(backlogDir), archiveRunsDir(backlogDir)]) {
    const candidate = path.join(dir, runId, "events.ndjson");
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

// Append a usage event to a run's events.ndjson. Called by executors
// when the provider returns a usage block.
export function recordUsage(backlogDir: string, runId: string, event: Omit<UsageEvent, "type" | "ts"> & { ts?: string }): void {
  const target = eventsPath(backlogDir, runId);
  if (!target) {
    throw new Error(`No events.ndjson for run ${runId}.`);
  }
  const full: UsageEvent = {
    ts: event.ts ?? new Date().toISOString(),
    type: "usage",
    message: usageMessage(event),
    provider: event.provider,
    model: event.model,
    input_tokens: event.input_tokens,
    output_tokens: event.output_tokens,
    ...(event.cache_read_input_tokens !== undefined ? { cache_read_input_tokens: event.cache_read_input_tokens } : {}),
    ...(event.cache_creation_input_tokens !== undefined ? { cache_creation_input_tokens: event.cache_creation_input_tokens } : {}),
  };
  fs.appendFileSync(target, JSON.stringify(full) + "\n", "utf8");
}

function readUsageEvents(backlogDir: string, runId: string): UsageEvent[] {
  const target = eventsPath(backlogDir, runId);
  if (!target) return [];
  const events: UsageEvent[] = [];
  for (const line of fs.readFileSync(target, "utf8").split("\n")) {
    if (!line) continue;
    try {
      const raw = JSON.parse(line) as Partial<UsageEvent>;
      if (raw.type === "usage" && typeof raw.model === "string") {
        events.push(raw as UsageEvent);
      }
    } catch {
      // Skip malformed lines — events.ndjson is append-only and must
      // tolerate partial writes from a crashed run.
    }
  }
  return events;
}

function listAllRunIds(backlogDir: string): string[] {
  const ids: string[] = [];
  for (const dir of [activeRunsDir(backlogDir), archiveRunsDir(backlogDir)]) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir)) {
      if (fs.existsSync(path.join(dir, entry, "events.ndjson"))) ids.push(entry);
    }
  }
  return ids;
}

export interface AggregateOptions {
  // Limit the aggregation to specific run ids. Without this, every
  // active and archived run is included.
  runIds?: string[];
  // Optional ISO date floor — only include usage events whose `ts`
  // is >= this string. Lets you ask "what did I spend this week?".
  sinceIso?: string;
}

export interface RunCostSummary {
  runId: string;
  totals: UsageTotals;
  perModel: Record<string, UsageTotals>;
}

// Estimate the USD cost of a future run, based on the median of past
// runs that match the given criteria. We deliberately use median (not
// mean) so a single $20 outlier doesn't shift the prediction. Returns
// null when fewer than 3 matching runs exist — small samples are too
// noisy to commit to a single number.
export interface CostEstimate {
  cost_usd: number;
  sample_size: number;
  // Same shape as UsageTotals but the values are medians, not sums.
  median_input_tokens: number;
  median_output_tokens: number;
}

export interface EstimateRunCostOptions {
  // Restrict the historical runs we consider to the ones whose run.json
  // matches these fields. Each filter is optional. The resulting set
  // must have at least 3 entries or estimateRunCost returns null.
  repo?: string;
  agent_id?: string;
  // ISO timestamp lower bound — only consider runs started after this.
  // Useful when pricing has just changed.
  sinceIso?: string;
}

function pickMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

function readRunJson(backlogDir: string, runId: string): Record<string, unknown> | null {
  for (const dir of [activeRunsDir(backlogDir), archiveRunsDir(backlogDir)]) {
    const candidate = path.join(dir, runId, "run.json");
    if (!fs.existsSync(candidate)) continue;
    try {
      return JSON.parse(fs.readFileSync(candidate, "utf8")) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

export function estimateRunCost(
  backlogDir: string,
  options: EstimateRunCostOptions = {},
): CostEstimate | null {
  const runIds = listAllRunIds(backlogDir);
  const perRun: { cost: number; input: number; output: number }[] = [];

  for (const runId of runIds) {
    const events = readUsageEvents(backlogDir, runId).filter((e) =>
      options.sinceIso ? e.ts >= options.sinceIso : true,
    );
    if (events.length === 0) continue;

    // Filter by repo / agent: read the run.json to learn its repo.
    if (options.repo || options.agent_id) {
      const run = readRunJson(backlogDir, runId);
      if (!run) continue;
      if (options.repo && run.repo !== options.repo) continue;
      if (options.agent_id && run.agent_id !== options.agent_id) continue;
    }

    const totals = emptyTotals();
    for (const event of events) add(totals, event);
    perRun.push({
      cost: totals.cost_usd,
      input: totals.input_tokens,
      output: totals.output_tokens,
    });
  }

  if (perRun.length < 3) return null;

  return {
    cost_usd: pickMedian(perRun.map((r) => r.cost)),
    sample_size: perRun.length,
    median_input_tokens: Math.round(pickMedian(perRun.map((r) => r.input))),
    median_output_tokens: Math.round(pickMedian(perRun.map((r) => r.output))),
  };
}

// Time bucket for cost time-series. The bucket key is an ISO date
// string truncated to the appropriate precision: "2026-04-28" for
// day, "2026-W17" for week (ISO week), "2026-04" for month.
export type CostBucket = "day" | "week" | "month";

function bucketKey(ts: string, bucket: CostBucket): string {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return "unknown";
  if (bucket === "month") return ts.slice(0, 7); // "YYYY-MM"
  if (bucket === "day") return ts.slice(0, 10); // "YYYY-MM-DD"
  // ISO week: pad year + ISO week-of-year. Approximation good enough
  // for cost reporting (the weeks-cross-year edge case at New Year
  // could be off by one but the report still groups consistently).
  const year = date.getUTCFullYear();
  const start = Date.UTC(year, 0, 1);
  const days = Math.floor((date.getTime() - start) / 86_400_000);
  const week = Math.floor(days / 7) + 1;
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export interface BucketedCost {
  bucket: string;
  totals: UsageTotals;
}

// Group usage events into time buckets and return one totals record
// per bucket, sorted by bucket key ascending. Used by `backlog runs
// cost --bucket day|week|month` to render a time-series.
export function aggregateUsageByBucket(
  backlogDir: string,
  bucket: CostBucket,
  options: AggregateOptions = {},
): BucketedCost[] {
  const runIds = options.runIds ?? listAllRunIds(backlogDir);
  const buckets = new Map<string, UsageTotals>();

  for (const runId of runIds) {
    const events = readUsageEvents(backlogDir, runId).filter((e) =>
      options.sinceIso ? e.ts >= options.sinceIso : true,
    );
    for (const event of events) {
      const key = bucketKey(event.ts, bucket);
      let totals = buckets.get(key);
      if (!totals) {
        totals = emptyTotals();
        buckets.set(key, totals);
      }
      add(totals, event);
    }
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([bucketKey_, totals]) => ({ bucket: bucketKey_, totals }));
}

// Aggregate usage events across runs. Returns the totals and a
// breakdown by model for each run (so a per-run cost report is one
// pass over the data, not one pass per run).
export function aggregateUsage(
  backlogDir: string,
  options: AggregateOptions = {},
): { runs: RunCostSummary[]; totals: UsageTotals; perModel: Record<string, UsageTotals> } {
  const runIds = options.runIds ?? listAllRunIds(backlogDir);
  const runs: RunCostSummary[] = [];
  const totals = emptyTotals();
  const perModel: Record<string, UsageTotals> = {};

  for (const runId of runIds) {
    const events = readUsageEvents(backlogDir, runId).filter((e) =>
      options.sinceIso ? e.ts >= options.sinceIso : true,
    );
    const runTotals = emptyTotals();
    const runPerModel: Record<string, UsageTotals> = {};
    for (const event of events) {
      add(runTotals, event);
      add(totals, event);
      const modelKey = event.model;
      if (!runPerModel[modelKey]) runPerModel[modelKey] = emptyTotals();
      add(runPerModel[modelKey], event);
      if (!perModel[modelKey]) perModel[modelKey] = emptyTotals();
      add(perModel[modelKey], event);
    }
    if (events.length > 0) {
      runs.push({ runId, totals: runTotals, perModel: runPerModel });
    }
  }

  return { runs, totals, perModel };
}
