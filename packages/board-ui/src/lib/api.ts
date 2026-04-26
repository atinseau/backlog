import type { BoardResponse } from "./types.js";

const BASE = "/api/v1";

export async function fetchBoard(repo?: string): Promise<BoardResponse> {
  const url = new URL(`${BASE}/board`, window.location.origin);
  if (repo) url.searchParams.set("repo", repo);
  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Board fetch failed: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as BoardResponse;
}

export async function fetchHealth(): Promise<{ ok: boolean; workspace: string; version: string }> {
  const response = await fetch(`${BASE}/health`);
  if (!response.ok) throw new Error(`Health failed: ${response.status}`);
  return response.json();
}

export async function moveWorkItem(id: string, to: string): Promise<void> {
  const response = await fetch(`${BASE}/work-items/${encodeURIComponent(id)}/move`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ to }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Move failed (${response.status}): ${detail}`);
  }
}

export interface ClaimCreateInput {
  repo: string;
  topic: string;
  paths: string[];
  ttl_minutes?: number;
  expected_duration_seconds?: number;
  agent_id?: string;
}

export interface ClaimConflict {
  error: "claim_overlap";
  conflict_with: string;
  blocking_topic: string;
  blocking_agent_id: string | null;
  blocking_paths: string[];
  blocking_expected_finish_at: string | null;
  blocking_expires_at: string;
  blocking_status: "active" | "overdue";
  retry_after_seconds: number;
  retry_after_source: "expected_finish_at" | "expires_at" | "fallback";
}

export type ClaimCreateResult =
  | { ok: true; claim: unknown }
  | { ok: false; conflict: ClaimConflict };

export type DecisionAction = "run" | "wait" | "block" | "skip";

export interface EnrichedDecision {
  task_id: string;
  work_item_id: string;
  task_title: string | null;
  work_item_title: string | null;
  repo: string | null;
  scopes: string[];
  action: DecisionAction;
  score: number;
  reasons: string[];
  assigned_agent_id: string | null;
  candidate_agent_ids: string[];
}

export interface ExecutionWave {
  wave: number;
  decisions: EnrichedDecision[];
}

export interface OrchestratePlan {
  generated_at: string;
  workspace: string;
  max_agents: number;
  runnable_count: number;
  waves: ExecutionWave[];
  waiting: EnrichedDecision[];
  blocked: EnrichedDecision[];
  skipped: EnrichedDecision[];
}

export async function fetchOrchestratePlan(): Promise<OrchestratePlan> {
  const response = await fetch(`${BASE}/orchestrate`);
  if (!response.ok) {
    throw new Error(`Orchestrate failed: ${response.status}`);
  }
  return (await response.json()) as OrchestratePlan;
}

export async function createClaim(input: ClaimCreateInput): Promise<ClaimCreateResult> {
  const response = await fetch(`${BASE}/claims`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (response.status === 201) {
    const json = (await response.json()) as { claim: unknown };
    return { ok: true, claim: json.claim };
  }
  if (response.status === 409) {
    const json = (await response.json()) as ClaimConflict;
    return { ok: false, conflict: json };
  }
  throw new Error(`Claim create failed: ${response.status}`);
}
