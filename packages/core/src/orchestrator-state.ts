import { type OrchestratorMode, type OrchestratorState } from "@backlog/schemas";
import { readOrchestratorState, writeOrchestratorState } from "./state-files.js";

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

  writeOrchestratorState(backlogDir, next);
  return next;
}
