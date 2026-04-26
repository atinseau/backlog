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

export interface SplitInput {
  repos?: string[];
  mode: "parallel" | "serial";
  scope_by_repo?: Record<string, string[]>;
  risk?: "low" | "medium" | "high";
  force?: boolean;
}

export interface SplitResult {
  work_item: unknown;
  created_tasks: Array<{ id: string; title: string; repo: string; scopes: string[] }>;
  mode: "parallel" | "serial";
}

export interface StartRunInput {
  task_id?: string;
  work_item_id?: string;
  max_start?: number;
  agent_id?: string;
  approve?: boolean;
}

export interface StartedRun {
  runId: string;
  taskId: string;
  agentId: string;
  branch: string;
  worktreePath: string;
  claimIds: string[];
}

export interface SkippedRun {
  taskId: string;
  reasons: string[];
}

export interface StartRunResult {
  started: StartedRun[];
  skipped: SkippedRun[];
  waiting: Array<{ task_id: string; reasons: string[] }>;
  blocked: Array<{ task_id: string; reasons: string[] }>;
}

export async function startRun(input: StartRunInput): Promise<StartRunResult> {
  const response = await fetch(`${BASE}/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const json = await response.json();
  if (!response.ok && response.status !== 202) {
    throw new Error(typeof json === "object" && json && "detail" in json
      ? `Run failed: ${(json as { detail: string }).detail}`
      : `Run failed: ${response.status}`);
  }
  return json as StartRunResult;
}

export interface ProposedTask {
  title: string;
  repo: string;
  scopes: string[];
  risk: "low" | "medium" | "high";
  depends_on_indices: number[];
}

export interface SplitProposal {
  work_item_id: string;
  model: string;
  rationale: string;
  tasks: ProposedTask[];
}

export type SuggestSplitResult =
  | { ok: true; proposal: SplitProposal }
  | { ok: false; error: "ai_unavailable" | "suggest_failed" | "no_repos"; detail: string };

export async function suggestSplit(workItemId: string): Promise<SuggestSplitResult> {
  const response = await fetch(`${BASE}/work-items/${encodeURIComponent(workItemId)}/suggest-split`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (response.ok) {
    const proposal = (await response.json()) as SplitProposal;
    return { ok: true, proposal };
  }
  const json = (await response.json().catch(() => ({}))) as { error?: string; detail?: string };
  return {
    ok: false,
    error: (json.error ?? "suggest_failed") as "ai_unavailable" | "suggest_failed" | "no_repos",
    detail: json.detail ?? `HTTP ${response.status}`,
  };
}

export async function applySplitProposal(
  workItemId: string,
  tasks: ProposedTask[],
  force = false,
): Promise<SplitResult> {
  const response = await fetch(`${BASE}/work-items/${encodeURIComponent(workItemId)}/apply-split`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tasks, force }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Apply split failed (${response.status}): ${detail}`);
  }
  return (await response.json()) as SplitResult;
}

export async function splitWorkItem(id: string, input: SplitInput): Promise<SplitResult> {
  const response = await fetch(`${BASE}/work-items/${encodeURIComponent(id)}/split`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Split failed (${response.status}): ${detail}`);
  }
  return (await response.json()) as SplitResult;
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
