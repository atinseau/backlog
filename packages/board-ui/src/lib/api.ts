import type {
  AgentSummary,
  BoardResponse,
  ClaimRecord,
  CurrentProject,
  OrchestratorState,
  Repo,
  ProjectEntry,
  ProjectInfo,
} from "./types.js";

const BASE = "/api/v1";

// Active workspace id used by every api.ts call. App.svelte sets it on mount
// and on user selection in the WorkspaceSelector. When null, the server falls
// back to the workspace it was launched with.
let currentWorkspaceId: string | null = null;

export function setCurrentProjectId(id: string | null): void {
  currentWorkspaceId = id;
}

export function getCurrentProjectId(): string | null {
  return currentWorkspaceId;
}

export function apiUrl(path: string, query: Record<string, string | undefined> = {}): string {
  const url = new URL(`${BASE}${path}`, window.location.origin);
  if (currentWorkspaceId) url.searchParams.set("workspace", currentWorkspaceId);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  return url.toString();
}

export async function fetchBoard(opts: { repo?: string } = {}): Promise<BoardResponse> {
  const response = await fetch(apiUrl("/board", { repo: opts.repo }));
  if (!response.ok) {
    throw new Error(`Board fetch failed: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as BoardResponse;
}

// Workspaces (registry) -----------------------------------------------------

export async function fetchProjectsList(): Promise<ProjectEntry[]> {
  const response = await fetch(apiUrl("/projects"));
  if (!response.ok) throw new Error(`Workspaces fetch failed: ${response.status}`);
  const json = (await response.json()) as { projects: ProjectEntry[] };
  return json.projects;
}

export async function fetchCurrentProject(): Promise<CurrentProject> {
  const response = await fetch(apiUrl("/projects/current"));
  if (!response.ok) throw new Error(`Current workspace fetch failed: ${response.status}`);
  return (await response.json()) as CurrentProject;
}

export async function registerProjectByPath(absolutePath: string): Promise<ProjectEntry> {
  const response = await fetch(apiUrl("/projects"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: absolutePath }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Register workspace failed (${response.status}): ${detail}`);
  }
  const json = (await response.json()) as { project: ProjectEntry };
  return json.project;
}

export async function unregisterProjectById(id: string): Promise<void> {
  const response = await fetch(apiUrl(`/projects/${encodeURIComponent(id)}`), { method: "DELETE" });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Unregister workspace failed (${response.status}): ${detail}`);
  }
}

export async function touchProjectById(id: string): Promise<void> {
  const response = await fetch(apiUrl(`/projects/${encodeURIComponent(id)}/touch`), { method: "PUT" });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Touch workspace failed (${response.status}): ${detail}`);
  }
}

// Permissions / agents / workspace ------------------------------------------

export async function fetchAgents(): Promise<AgentSummary[]> {
  const response = await fetch(apiUrl("/agents"));
  if (!response.ok) throw new Error(`Agents fetch failed: ${response.status}`);
  const json = (await response.json()) as { agents: AgentSummary[] };
  return json.agents;
}

export interface UpdateAgentInput {
  enabled?: boolean;
  max_concurrent_runs?: number;
  sandbox_mode?: "read-only" | "workspace-write" | "danger-full-access" | null;
  success_mode?: "review" | "complete" | null;
  allowed_repos?: string[];
  allowed_risk?: Array<"low" | "medium" | "high">;
  capabilities?: string[];
  model?: string | null;
  profile?: string | null;
}

export async function patchAgent(id: string, input: UpdateAgentInput): Promise<unknown> {
  const response = await fetch(apiUrl(`/agents/${encodeURIComponent(id)}`), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Update agent failed (${response.status}): ${detail}`);
  }
  return response.json();
}

export async function fetchWorkspace(): Promise<ProjectInfo> {
  const response = await fetch(apiUrl("/workspace"));
  if (!response.ok) throw new Error(`Workspace fetch failed: ${response.status}`);
  const json = (await response.json()) as { project: ProjectInfo };
  return json.project;
}

export async function setAutonomyMode(mode: ProjectInfo["autonomy_mode"]): Promise<void> {
  const response = await fetch(apiUrl("/workspace/autonomy"), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ autonomy_mode: mode }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Autonomy update failed (${response.status}): ${detail}`);
  }
}

export async function setClaimsConfig(input: {
  ttl_minutes?: number;
  enforce_on_commit?: boolean;
}): Promise<void> {
  const response = await fetch(apiUrl("/workspace/claims"), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Claims config update failed (${response.status}): ${detail}`);
  }
}

// Repos ---------------------------------------------------------------------

export async function fetchRepos(): Promise<Repo[]> {
  const response = await fetch(apiUrl("/repos"));
  if (!response.ok) throw new Error(`Repos fetch failed: ${response.status}`);
  const json = (await response.json()) as { repos: Repo[] };
  return json.repos;
}

export interface CreateRepoInput {
  id?: string;
  path?: string;
  default_branch?: string;
  role?: string;
  enabled?: boolean;
  git_url?: string;
  clone_into?: string;
}

export async function createRepo(input: CreateRepoInput): Promise<{ repo: Repo; cloned: boolean }> {
  const response = await fetch(apiUrl("/repos"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Create repo failed (${response.status}): ${detail}`);
  }
  return (await response.json()) as { repo: Repo; cloned: boolean };
}

export interface UpdateRepoInput {
  id?: string;
  path?: string;
  default_branch?: string;
  role?: string | null;
  enabled?: boolean;
}

export async function updateRepo(id: string, input: UpdateRepoInput): Promise<Repo> {
  const response = await fetch(apiUrl(`/repos/${encodeURIComponent(id)}`), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Update repo failed (${response.status}): ${detail}`);
  }
  const json = (await response.json()) as { repo: Repo };
  return json.repo;
}

export async function deleteRepo(id: string, options: { force?: boolean } = {}): Promise<void> {
  const response = await fetch(
    apiUrl(`/repos/${encodeURIComponent(id)}`, options.force ? { force: "1" } : {}),
    { method: "DELETE" },
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Delete repo failed (${response.status}): ${detail}`);
  }
}

// Orchestrator --------------------------------------------------------------

export async function fetchOrchestratorState(): Promise<OrchestratorState> {
  const response = await fetch(apiUrl("/orchestrator/state"));
  if (!response.ok) throw new Error(`Orchestrator state failed: ${response.status}`);
  const json = (await response.json()) as { state: OrchestratorState };
  return json.state;
}

export async function startOrchestrator(input: {
  max_agents?: number;
  auto_pick_agents?: boolean;
  tick_interval_ms?: number;
} = {}): Promise<OrchestratorState> {
  const response = await fetch(apiUrl("/orchestrator/start"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Start orchestrator failed (${response.status}): ${detail}`);
  }
  const json = (await response.json()) as { state: OrchestratorState };
  return json.state;
}

export async function pauseOrchestrator(): Promise<OrchestratorState> {
  const response = await fetch(apiUrl("/orchestrator/pause"), { method: "POST" });
  if (!response.ok) throw new Error(`Pause orchestrator failed: ${response.status}`);
  const json = (await response.json()) as { state: OrchestratorState };
  return json.state;
}

export async function stopOrchestrator(): Promise<OrchestratorState> {
  const response = await fetch(apiUrl("/orchestrator/stop"), { method: "POST" });
  if (!response.ok) throw new Error(`Stop orchestrator failed: ${response.status}`);
  const json = (await response.json()) as { state: OrchestratorState };
  return json.state;
}

export async function patchOrchestratorConfig(input: {
  max_agents?: number;
  auto_pick_agents?: boolean;
  tick_interval_ms?: number;
}): Promise<OrchestratorState> {
  const response = await fetch(apiUrl("/orchestrator/config"), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Config orchestrator failed (${response.status}): ${detail}`);
  }
  const json = (await response.json()) as { state: OrchestratorState };
  return json.state;
}

// Tasks + sub-tasks ---------------------------------------------------------

export interface CreateTaskInput {
  title: string;
  description?: string;
  priority?: "P0" | "P1" | "P2" | "P3";
  repo_targets?: string[];
  labels?: string[];
  acceptance_criteria?: string[];
  estimated_duration_seconds?: number;
}

export interface CreatedTask {
  id: string;
  title: string;
  status: string;
  priority: "P0" | "P1" | "P2" | "P3";
  repo_targets: string[];
}

export async function createTask(input: CreateTaskInput): Promise<CreatedTask> {
  const response = await fetch(apiUrl("/tasks"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Create task failed (${response.status}): ${detail}`);
  }
  const json = (await response.json()) as { task: CreatedTask };
  return json.task;
}

export async function reorderTask(
  id: string,
  input: { before_id?: string; after_id?: string },
): Promise<void> {
  const response = await fetch(apiUrl(`/tasks/${encodeURIComponent(id)}/reorder`), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Reorder failed (${response.status}): ${detail}`);
  }
}

export interface CreateSubTaskInput {
  work_item_id: string;
  title: string;
  repo: string;
  scopes?: string[];
  depends_on?: string[];
  risk?: "low" | "medium" | "high";
  lane?: string;
}

export async function createSubTask(input: CreateSubTaskInput): Promise<unknown> {
  const response = await fetch(apiUrl("/subtasks"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Create sub-task failed (${response.status}): ${detail}`);
  }
  return (await response.json()) as unknown;
}

export async function reorderSubTask(id: string, input: { before_id?: string; after_id?: string }): Promise<void> {
  const response = await fetch(apiUrl(`/subtasks/${encodeURIComponent(id)}/reorder`), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Reorder task failed (${response.status}): ${detail}`);
  }
}

export async function setSubTaskEstimate(id: string, seconds: number | null): Promise<void> {
  const response = await fetch(apiUrl(`/subtasks/${encodeURIComponent(id)}/estimate`), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ seconds, source: seconds === null ? undefined : "manual" }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Estimate failed (${response.status}): ${detail}`);
  }
}

export async function fetchHealth(): Promise<{ ok: boolean; workspace: string; version: string }> {
  const response = await fetch(apiUrl("/health"));
  if (!response.ok) throw new Error(`Health failed: ${response.status}`);
  return response.json();
}

export async function moveWorkItem(id: string, to: string): Promise<void> {
  const response = await fetch(apiUrl(`/tasks/${encodeURIComponent(id)}/move`), {
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
  const response = await fetch(apiUrl("/orchestrate"));
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
  const response = await fetch(apiUrl("/runs"), {
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
  const response = await fetch(apiUrl(`/tasks/${encodeURIComponent(workItemId)}/suggest-split`), {
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
  const response = await fetch(apiUrl(`/tasks/${encodeURIComponent(workItemId)}/apply-split`), {
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

export async function splitTask(id: string, input: SplitInput): Promise<SplitResult> {
  const response = await fetch(apiUrl(`/tasks/${encodeURIComponent(id)}/split`), {
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

export async function fetchAllClaims(opts: { repo?: string; archived?: boolean } = {}): Promise<ClaimRecord[]> {
  const response = await fetch(
    apiUrl("/claims", {
      repo: opts.repo,
      archived: opts.archived ? "1" : undefined,
    }),
  );
  if (!response.ok) throw new Error(`Claims fetch failed: ${response.status}`);
  const json = (await response.json()) as { claims: ClaimRecord[] };
  return json.claims;
}

export async function archiveClaim(id: string): Promise<void> {
  const response = await fetch(apiUrl(`/claims/${encodeURIComponent(id)}`), { method: "DELETE" });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Archive claim failed (${response.status}): ${detail}`);
  }
}

export async function createClaim(input: ClaimCreateInput): Promise<ClaimCreateResult> {
  const response = await fetch(apiUrl("/claims"), {
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

// Commits -------------------------------------------------------------------

export interface CommitLink {
  kind: "task" | "subtask" | "claim";
  id: string;
}

export interface CommitEntry {
  repo: string;
  sha: string;
  short_sha: string;
  subject: string;
  author: string;
  date: string;
  links: CommitLink[];
}

export async function fetchCommits(limit = 50): Promise<CommitEntry[]> {
  const response = await fetch(apiUrl("/commits", { limit: String(limit) }));
  if (!response.ok) throw new Error(`Commits fetch failed: ${response.status}`);
  const json = (await response.json()) as { commits: CommitEntry[] };
  return json.commits;
}
