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
  provider: UsageProvider;
  model: string; // e.g. "claude-sonnet-4-6", "gpt-5"
  // Counts in tokens. Cache_read = served from prompt cache (cheap).
  // cache_creation = the first call that populates the cache (premium).
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
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
  "claude-opus-4-7": { input: 15, output: 75 },
  "claude-opus-4-6": { input: 15, output: 75 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-sonnet-4-5": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 0.25, output: 1.25 },
  // OpenAI / Codex (placeholder; replace with verified figures)
  "gpt-5": { input: 1.25, output: 10 },
  "gpt-5-mini": { input: 0.15, output: 0.6 },
};

function pricingFor(model: string): ModelPricing | null {
  // Tolerate vendor-prefixed slugs ("anthropic/claude-…") and date suffixes.
  const normalized = model.toLowerCase().replace(/^[^/]+\//, "").replace(/-\d{8}$/, "");
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
