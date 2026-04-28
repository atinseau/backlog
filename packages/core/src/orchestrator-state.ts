import { type OrchestratorMode, type OrchestratorState } from "@backlog/schemas";
import { readOrchestratorState, writeOrchestratorState } from "./state-files.js";

// How long we let last_tick_at lag the on-disk value before forcing a
// flush. The hydrate path on serve startup checks `last_tick_at < 60s`
// to decide whether to resume the loop — keeping the disk value within
// 30s preserves that signal without 12× writes per minute.
const TICK_FLUSH_INTERVAL_MS = 30_000;

export function getOrchestratorState(backlogDir: string): OrchestratorState {
  return readOrchestratorState(backlogDir);
}

export interface UpdateOrchestratorStateInput {
  mode?: OrchestratorMode;
  max_agents?: number;
  auto_pick_agents?: boolean;
  tick_interval_ms?: number;
  started_at?: string | null;
  paused_at?: string | null;
  last_tick_at?: string;
  last_started_count?: number;
  last_error?: string | null;
}

// Determine whether two states differ in any field other than
// last_tick_at. Used by the coalescer to skip a write when only the
// heartbeat moved.
function hasNonTickDiff(a: OrchestratorState, b: OrchestratorState): boolean {
  const keys: (keyof OrchestratorState)[] = [
    "version",
    "mode",
    "max_agents",
    "auto_pick_agents",
    "tick_interval_ms",
    "started_at",
    "paused_at",
    "last_started_count",
    "last_error",
  ];
  for (const k of keys) {
    if (a[k] !== b[k]) return true;
  }
  return false;
}

export function updateOrchestratorState(
  backlogDir: string,
  input: UpdateOrchestratorStateInput,
): OrchestratorState {
  const current = readOrchestratorState(backlogDir);
  const next: OrchestratorState = { ...current };

  if (input.mode !== undefined) next.mode = input.mode;
  if (input.max_agents !== undefined) next.max_agents = input.max_agents;
  if (input.auto_pick_agents !== undefined) next.auto_pick_agents = input.auto_pick_agents;
  if (input.tick_interval_ms !== undefined) next.tick_interval_ms = input.tick_interval_ms;

  if (input.started_at !== undefined) {
    if (input.started_at === null) delete next.started_at;
    else next.started_at = input.started_at;
  }
  if (input.paused_at !== undefined) {
    if (input.paused_at === null) delete next.paused_at;
    else next.paused_at = input.paused_at;
  }
  if (input.last_tick_at !== undefined) next.last_tick_at = input.last_tick_at;
  if (input.last_started_count !== undefined) next.last_started_count = input.last_started_count;
  if (input.last_error !== undefined) {
    if (input.last_error === null) delete next.last_error;
    else next.last_error = input.last_error;
  }

  // Coalesce heartbeat-only writes: if the only change is last_tick_at
  // moving forward AND the on-disk value is fresh enough that the
  // hydrate check (last_tick_at < 60s) still works, skip the disk
  // write and return the new state to the caller. The orchestrator
  // loop ticks every 5s by default — without this, a healthy idle
  // orchestrator generates 12 file writes per minute on top of FS
  // events watchers (Spotlight, iCloud, Dropbox).
  const heartbeatOnly = !hasNonTickDiff(current, next) && input.last_tick_at !== undefined;
  if (heartbeatOnly) {
    const previousTickMs = current.last_tick_at ? Date.parse(current.last_tick_at) : 0;
    const nextTickMs = Date.parse(next.last_tick_at!);
    if (Number.isFinite(previousTickMs) && nextTickMs - previousTickMs < TICK_FLUSH_INTERVAL_MS) {
      return next;
    }
  }

  writeOrchestratorState(backlogDir, next);
  return next;
}
