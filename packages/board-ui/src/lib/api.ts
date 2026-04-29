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

// Re-export so callers that already pull from this module (e.g. SplitDialog
// importing splitTask + AgentSummary in one block) don't have to dual-import
// from ./types.js.
export type { AgentSummary } from "./types.js";

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

export interface InitProjectInput {
  path: string;
  name: string;
  default_branch?: string;
  force?: boolean;
}

export async function initProject(input: InitProjectInput): Promise<ProjectEntry> {
  const response = await fetch(apiUrl("/projects/init"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const json = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
    throw new Error(json.message ?? json.error ?? `HTTP ${response.status}`);
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

export async function renameProjectById(id: string, name: string): Promise<ProjectEntry> {
  const response = await fetch(apiUrl(`/projects/${encodeURIComponent(id)}`), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(typeof json === "object" && json && "error" in json
      ? String((json as { error: string }).error)
      : `Rename failed: ${response.status}`);
  }
  return (json as { project: ProjectEntry }).project;
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

export interface CreateAgentInput {
  id: string;
  provider: "claude" | "codex" | "custom" | "manual";
  model?: string;
  profile?: string;
  command?: string;
  enabled?: boolean;
  sandbox_mode?: "read-only" | "workspace-write" | "danger-full-access";
  success_mode?: "review" | "complete";
  max_concurrent_runs?: number;
  allowed_risk?: Array<"low" | "medium" | "high">;
  allowed_repos?: string[];
  capabilities?: string[];
}

export async function createAgent(input: CreateAgentInput): Promise<unknown> {
  const response = await fetch(apiUrl("/agents"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Create agent failed (${response.status}): ${detail}`);
  }
  return response.json();
}

export async function deleteAgent(id: string): Promise<void> {
  const response = await fetch(apiUrl(`/agents/${encodeURIComponent(id)}`), { method: "DELETE" });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Delete agent failed (${response.status}): ${detail}`);
  }
}

// Users (human collaborators) ------------------------------------------------

export async function fetchUsers(): Promise<import("./types.js").UserSummary[]> {
  const response = await fetch(apiUrl("/users"));
  if (!response.ok) throw new Error(`Users fetch failed: ${response.status}`);
  const json = (await response.json()) as { users: import("./types.js").UserSummary[] };
  return json.users;
}

export interface InviteUserInput {
  email: string;
  display_name?: string;
  role?: import("./types.js").UserRole;
}

export async function inviteUser(input: InviteUserInput): Promise<import("./types.js").UserSummary> {
  const response = await fetch(apiUrl("/users/invite"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Invite failed (${response.status}): ${detail}`);
  }
  const json = (await response.json()) as { user: import("./types.js").UserSummary };
  return json.user;
}

export async function patchUser(id: string, input: { display_name?: string; role?: import("./types.js").UserRole; status?: import("./types.js").UserStatus }): Promise<import("./types.js").UserSummary> {
  const response = await fetch(apiUrl(`/users/${encodeURIComponent(id)}`), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Update user failed (${response.status}): ${detail}`);
  }
  const json = (await response.json()) as { user: import("./types.js").UserSummary };
  return json.user;
}

export async function deleteUser(id: string): Promise<void> {
  const response = await fetch(apiUrl(`/users/${encodeURIComponent(id)}`), { method: "DELETE" });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Delete user failed (${response.status}): ${detail}`);
  }
}

export async function refreshUserInvitation(id: string): Promise<import("./types.js").UserSummary> {
  const response = await fetch(apiUrl(`/users/${encodeURIComponent(id)}/refresh-invitation`), { method: "POST" });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Refresh invitation failed (${response.status}): ${detail}`);
  }
  const json = (await response.json()) as { user: import("./types.js").UserSummary };
  return json.user;
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
  auto_claim_on_commit?: boolean;
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

export interface ReviewConfig {
  show_review_column?: boolean;
  auto_reviewer_agent_id?: string | null;
}

export async function setReviewConfig(input: ReviewConfig): Promise<{ review: { show_review_column: boolean; auto_reviewer_agent_id?: string } }> {
  const response = await fetch(apiUrl("/workspace/review"), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Review config update failed (${response.status}): ${detail}`);
  }
  return (await response.json()) as { review: { show_review_column: boolean; auto_reviewer_agent_id?: string } };
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
  access_mode?: import("./types.js").RepoAccessMode;
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
  access_mode?: import("./types.js").RepoAccessMode;
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
  // Title is now optional client-side: leave it out and the server
  // synthesises one from the description via the AI title-suggester
  // (with a first-sentence fallback when the LLM is unavailable).
  // CLI / API callers that already have a polished title still pass
  // it explicitly.
  title?: string;
  description?: string;
  priority?: "P0" | "P1" | "P2" | "P3";
  repo_targets?: string[];
  labels?: string[];
  acceptance_criteria?: string[];
  estimated_duration_seconds?: number;
  manual_approval_required?: boolean;
  auto_commit?: boolean;
  push_when_done?: boolean;
  create_pr?: boolean;
  merge_pr?: boolean;
  worktree_mode?: "isolated_worktree" | "direct";
  preferred_agents?: string[];
}

export interface CreatedTask {
  id: string;
  title: string;
  status: string;
  priority: "P0" | "P1" | "P2" | "P3";
  repo_targets: string[];
}

export interface CreateTaskResult {
  task: CreatedTask;
  // How the title ended up on the persisted task. Lets the UI show
  // a tiny "Generated by Claude Haiku" hint when the AI was used,
  // or a "fallback" warning when the LLM was unavailable.
  title_source: "user" | "ai" | "fallback";
  title_model?: string;
}

export async function createTask(input: CreateTaskInput): Promise<CreateTaskResult> {
  const response = await fetch(apiUrl("/tasks"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Create task failed (${response.status}): ${detail}`);
  }
  return (await response.json()) as CreateTaskResult;
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
  task_id: string;
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

export async function setSubTaskAssignee(id: string, agentId: string | null): Promise<void> {
  const response = await fetch(apiUrl(`/subtasks/${encodeURIComponent(id)}/assignee`), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agent_id: agentId }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Assign failed (${response.status}): ${detail}`);
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
  // The executable subtask this decision is about. Each row in the
  // orchestrator panel corresponds to one subtask, so this is the
  // unique key.
  subtask_id: string;
  // The parent task (work item) the subtask belongs to.
  task_id: string;
  task_title: string | null;
  subtask_title: string | null;
  // Median USD cost predicted from past runs that share the same
  // (repo, agent) pair. null when there's not enough history.
  predicted_cost_usd?: number | null;
  predicted_cost_sample_size?: number | null;
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
  // Start the planned wave for a single executable subtask. Mutually
  // useful with task_id below — pass whichever you have.
  subtask_id?: string;
  // Start the planned wave for a parent task (executes any of its
  // ready subtasks, picked by the scheduler).
  task_id?: string;
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
  // Server reports waiting/blocked subtasks here (it sends `subtask_id`
  // — see runsRoutes in @backlog/server). Don't confuse with the parent
  // task_id elsewhere in this module.
  waiting: Array<{ subtask_id: string; reasons: string[] }>;
  blocked: Array<{ subtask_id: string; reasons: string[] }>;
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

export interface RunDiff {
  run_id: string;
  file: string;
  base: string;
  head: string;
  diff: string;
  empty: boolean;
}

export async function fetchRunDiff(runId: string, file: string, base?: string): Promise<RunDiff> {
  const query: Record<string, string | undefined> = { file };
  if (base) query["base"] = base;
  const response = await fetch(apiUrl(`/runs/${runId}/diff`, query));
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(
      typeof detail === "object" && detail && "detail" in detail
        ? `Diff failed: ${(detail as { detail: string }).detail}`
        : `Diff failed: ${response.status}`,
    );
  }
  return (await response.json()) as RunDiff;
}

export async function cancelRun(runId: string, summary?: string): Promise<void> {
  const response = await fetch(apiUrl(`/runs/${encodeURIComponent(runId)}/cancel`), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(summary ? { summary } : {}),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Cancel run failed (${response.status}): ${detail}`);
  }
}

export async function approveRun(runId: string, summary?: string): Promise<void> {
  const response = await fetch(apiUrl(`/runs/${runId}/approve`), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(summary ? { summary } : {}),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(
      typeof detail === "object" && detail && "detail" in detail
        ? `Approve failed: ${(detail as { detail: string }).detail}`
        : `Approve failed: ${response.status}`,
    );
  }
}

export interface ProposedTask {
  title: string;
  repo: string;
  scopes: string[];
  risk: "low" | "medium" | "high";
  depends_on_indices: number[];
}

export interface SplitProposal {
  task_id: string;
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

export interface TaskDetail {
  id: string;
  title: string;
  description?: string;
  status: string;
  priority: "P0" | "P1" | "P2" | "P3";
  labels: string[];
  repo_targets: string[];
  acceptance_criteria: string[];
  dependencies: string[];
  source_links: Array<{ kind: string; external_id: string; url?: string; source_ref?: string }>;
  estimated_duration_seconds?: number;
  planning: { split_status: "pending" | "done"; risk: "low" | "medium" | "high"; preferred_lane?: string };
  created_at: string;
  updated_at: string;
}

export interface SubTaskDetail {
  id: string;
  task_id: string;
  title: string;
  repo: string;
  status: string;
  priority_score: number;
  risk: "low" | "medium" | "high";
  scopes: string[];
  depends_on: string[];
  blockers: string[];
  estimated_duration_seconds?: number;
  progress_percent?: number;
  execution?: {
    lane?: string;
    preferred_agents: string[];
    required_capabilities: string[];
    manual_approval_required: boolean;
  };
}

export async function fetchTaskDetail(id: string): Promise<{ task: TaskDetail; subtasks: SubTaskDetail[] }> {
  const response = await fetch(apiUrl(`/tasks/${encodeURIComponent(id)}`));
  if (!response.ok) {
    throw new Error(`Task fetch failed: ${response.status}`);
  }
  return (await response.json()) as { task: TaskDetail; subtasks: SubTaskDetail[] };
}

export async function fetchCommits(limit = 50): Promise<CommitEntry[]> {
  const response = await fetch(apiUrl("/commits", { limit: String(limit) }));
  if (!response.ok) throw new Error(`Commits fetch failed: ${response.status}`);
  const json = (await response.json()) as { commits: CommitEntry[] };
  return json.commits;
}

// Integrations: GitHub + Jira ----------------------------------------------

export interface GithubStatus {
  connected: boolean;
  token_hint: string | null;
}

export async function fetchGithubStatus(): Promise<GithubStatus> {
  const response = await fetch(apiUrl("/integrations/github/status"));
  if (!response.ok) throw new Error(`GitHub status failed: ${response.status}`);
  return (await response.json()) as GithubStatus;
}

export interface GithubOauthConfig {
  device_flow_available: boolean;
  client_id_hint: string | null;
  client_id_source: "env" | "user" | "cloud" | null;
  pat_url: string;
  register_url: string;
}

export async function saveGithubOauthClientId(clientId: string): Promise<void> {
  const response = await fetch(apiUrl("/integrations/github/oauth/client"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_id: clientId }),
  });
  if (!response.ok) throw new Error(`Save client_id failed: ${response.status}`);
}

export async function clearGithubOauthClientId(): Promise<void> {
  await fetch(apiUrl("/integrations/github/oauth/client"), { method: "DELETE" });
}

export interface JiraOauthConfig {
  oauth_available: boolean;
  client_id_hint: string | null;
  mode: "cloud" | "byo";
  cloud_url: string;
  register_url: string;
  scopes: string;
  connected: boolean;
  site_url: string | null;
}

export async function fetchJiraOauthConfig(): Promise<JiraOauthConfig> {
  const response = await fetch(apiUrl("/integrations/jira/oauth/config"));
  if (!response.ok) throw new Error(`Jira OAuth config failed: ${response.status}`);
  return (await response.json()) as JiraOauthConfig;
}

export async function saveJiraOauthClient(input: { client_id: string; client_secret: string }): Promise<void> {
  const response = await fetch(apiUrl("/integrations/jira/oauth/client"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(`Save Jira credentials failed: ${response.status}`);
}

export async function clearJiraOauthClient(): Promise<void> {
  await fetch(apiUrl("/integrations/jira/oauth/client"), { method: "DELETE" });
}

export async function startJiraOauth(): Promise<{ authorize_url: string; state: string }> {
  const response = await fetch(apiUrl("/integrations/jira/oauth/start"), { method: "POST" });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(typeof json === "object" && json && "detail" in json
      ? (json as { detail: string }).detail
      : `HTTP ${response.status}`);
  }
  return json as { authorize_url: string; state: string };
}

export type JiraOauthStatus =
  | { status: "ok"; display_name: string; site_url: string; cloud_id: string }
  | { status: "pending" }
  | { status: "failed"; detail?: string }
  | { status: "expired" }
  | { status: "missing_state" };

export async function pollJiraOauthStatus(state: string): Promise<JiraOauthStatus> {
  const response = await fetch(apiUrl(`/integrations/jira/oauth/status?state=${encodeURIComponent(state)}`));
  return (await response.json()) as JiraOauthStatus;
}

// Cloud account ------------------------------------------------------------

export interface CloudUser {
  id: number;
  email: string;
  plan: "free" | "pro" | "enterprise";
  repos_used: number;
  repos_limit: number | null;
  can_connect_repo: boolean;
}

export interface CloudStatus {
  signed_in: boolean;
  user?: CloudUser;
  expired?: boolean;
  error?: string;
}

export async function fetchCloudStatus(): Promise<CloudStatus> {
  const response = await fetch(apiUrl("/cloud/me"));
  return (await response.json()) as CloudStatus;
}

export interface CloudCredentials {
  email: string;
  password: string;
}

export interface CloudAuthResult {
  ok: boolean;
  user?: CloudUser;
  error?: string;
  details?: unknown;
}

export async function cloudSignup(input: CloudCredentials): Promise<CloudAuthResult> {
  const response = await fetch(apiUrl("/cloud/signup"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const json = await response.json();
  if (!response.ok) {
    return { ok: false, error: (json as { error?: string }).error ?? `HTTP ${response.status}`, details: (json as { details?: unknown }).details };
  }
  return json as CloudAuthResult;
}

export async function cloudLogin(input: CloudCredentials): Promise<CloudAuthResult> {
  const response = await fetch(apiUrl("/cloud/login"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const json = await response.json();
  if (!response.ok) {
    return { ok: false, error: (json as { error?: string }).error ?? `HTTP ${response.status}`, details: (json as { details?: unknown }).details };
  }
  return json as CloudAuthResult;
}

export async function cloudLogout(): Promise<void> {
  await fetch(apiUrl("/cloud/logout"), { method: "POST" });
}

export type OauthProvider = "google_oauth2" | "github" | "apple";

export async function startCloudOauth(provider: OauthProvider): Promise<{ authorize_url: string }> {
  const response = await fetch(apiUrl("/cloud/oauth/start", { provider }));
  const json = await response.json();
  if (!response.ok) {
    throw new Error(typeof json === "object" && json && "error" in json
      ? (json as { error: string }).error
      : `HTTP ${response.status}`);
  }
  return json as { authorize_url: string };
}

export interface CloudBillingResult {
  url?: string;
  error?: string;
  details?: unknown;
}

export async function cloudBillingCheckout(interval: "monthly" | "yearly" = "monthly"): Promise<CloudBillingResult> {
  const response = await fetch(apiUrl("/cloud/billing/checkout"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ interval }),
  });
  return (await response.json()) as CloudBillingResult;
}

export async function cloudBillingPortal(): Promise<CloudBillingResult> {
  const response = await fetch(apiUrl("/cloud/billing/portal"), {
    method: "POST",
  });
  return (await response.json()) as CloudBillingResult;
}

export async function fetchGithubOauthConfig(): Promise<GithubOauthConfig> {
  const response = await fetch(apiUrl("/integrations/github/oauth/config"));
  if (!response.ok) throw new Error(`GitHub OAuth config failed: ${response.status}`);
  return (await response.json()) as GithubOauthConfig;
}

export interface GithubDeviceStart {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export async function startGithubDeviceFlow(): Promise<GithubDeviceStart> {
  const response = await fetch(apiUrl("/integrations/github/oauth/start"), { method: "POST" });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(typeof json === "object" && json && "detail" in json
      ? (json as { detail: string }).detail
      : `HTTP ${response.status}`);
  }
  return json as GithubDeviceStart;
}

export type GithubDevicePoll =
  | { status: "ok"; login: string }
  | { status: "pending"; error: "authorization_pending" | "slow_down" }
  | { status: "failed"; error: string; detail?: string | null }
  | { status: "verify_failed"; detail?: string };

export async function pollGithubDeviceFlow(deviceCode: string): Promise<GithubDevicePoll> {
  const response = await fetch(apiUrl("/integrations/github/oauth/poll"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ device_code: deviceCode }),
  });
  return (await response.json()) as GithubDevicePoll;
}

export async function setGithubPat(token: string): Promise<{ login: string }> {
  const response = await fetch(apiUrl("/integrations/github/pat"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(typeof json === "object" && json && "detail" in json
      ? (json as { detail: string }).detail
      : `HTTP ${response.status}`);
  }
  return json as { login: string };
}

export async function clearGithubPat(): Promise<void> {
  await fetch(apiUrl("/integrations/github/pat"), { method: "DELETE" });
}

export interface GithubRepoSummary {
  full_name: string;
  description: string | null;
  private: boolean;
  default_branch: string;
  clone_url: string;
  ssh_url: string;
  html_url: string;
  pushed_at: string;
}

export async function listGithubRepos(): Promise<GithubRepoSummary[]> {
  const response = await fetch(apiUrl("/integrations/github/repos"));
  const json = await response.json();
  if (!response.ok) {
    throw new Error(typeof json === "object" && json && "detail" in json
      ? (json as { detail: string }).detail
      : `HTTP ${response.status}`);
  }
  return (json as { repos: GithubRepoSummary[] }).repos;
}

export async function cloneGithubRepo(input: {
  full_name: string;
  default_branch?: string;
  id?: string;
  use_ssh?: boolean;
}): Promise<{ repo: Repo; cloned: boolean }> {
  const response = await fetch(apiUrl("/integrations/github/clone"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(typeof json === "object" && json && "detail" in json
      ? (json as { detail: string }).detail
      : `HTTP ${response.status}`);
  }
  return json as { repo: Repo; cloned: boolean };
}

export async function addGithubSource(input: {
  id: string;
  repo: string;
  labels?: string;
  state?: "open" | "closed" | "all";
}): Promise<unknown> {
  const response = await fetch(apiUrl("/integrations/github/source"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(typeof json === "object" && json && "detail" in json
      ? (json as { detail: string }).detail
      : `HTTP ${response.status}`);
  }
  return json;
}

export interface JiraTestResult {
  ok: boolean;
  account_id: string;
  display_name: string;
}

export async function testJira(input: {
  base_url: string;
  email: string;
  api_token: string;
}): Promise<JiraTestResult> {
  const response = await fetch(apiUrl("/integrations/jira/test"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(typeof json === "object" && json && "detail" in json
      ? (json as { detail: string }).detail
      : `HTTP ${response.status}`);
  }
  return json as JiraTestResult;
}

export async function addJiraSource(input: {
  id: string;
  base_url: string;
  email: string;
  api_token: string;
  jql?: string;
}): Promise<unknown> {
  const response = await fetch(apiUrl("/integrations/jira/source"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(typeof json === "object" && json && "detail" in json
      ? (json as { detail: string }).detail
      : `HTTP ${response.status}`);
  }
  return json;
}

export interface SourceSummary {
  id: string;
  kind: "jira" | "github" | "markdown" | "csv";
  enabled: boolean;
  config: Record<string, unknown>;
}

export async function listSources(): Promise<SourceSummary[]> {
  const response = await fetch(apiUrl("/integrations/sources"));
  if (!response.ok) throw new Error(`Sources fetch failed: ${response.status}`);
  const json = (await response.json()) as { sources: SourceSummary[] };
  return json.sources;
}

export async function deleteSource(id: string): Promise<void> {
  const response = await fetch(apiUrl(`/integrations/sources/${encodeURIComponent(id)}`), {
    method: "DELETE",
  });
  if (!response.ok) throw new Error(`Delete source failed: ${response.status}`);
}

export interface SyncResult {
  source_id: string;
  pulled_total: number;
  created: number;
  skipped: number;
}

export async function syncSource(id: string): Promise<SyncResult> {
  const response = await fetch(apiUrl(`/integrations/sources/${encodeURIComponent(id)}/sync`), {
    method: "POST",
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(typeof json === "object" && json && "detail" in json
      ? (json as { detail: string }).detail
      : `HTTP ${response.status}`);
  }
  return json as SyncResult;
}

// --- Folder inspector (used by the create-project / add-repo flows) ---
export interface FolderInspect {
  exists: boolean;
  is_directory: boolean;
  is_git_repo: boolean;
  has_backlog_dir: boolean;
  basename: string;
  current_branch: string | null;
  branches: string[];
}
export async function inspectFolder(absolutePath: string): Promise<FolderInspect> {
  const response = await fetch(apiUrl("/folders/inspect", { path: absolutePath }));
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as FolderInspect;
}

// --- Secrets (API keys) ---
export type SecretKey = "ANTHROPIC_API_KEY" | "OPENAI_API_KEY";

export async function fetchSecretsList(): Promise<{ key: string; set: boolean }[]> {
  const response = await fetch(apiUrl("/secrets"));
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const json = (await response.json()) as { keys: { key: string; set: boolean }[] };
  return json.keys;
}

export async function setSecret(key: SecretKey, value: string): Promise<void> {
  const response = await fetch(apiUrl(`/secrets/${encodeURIComponent(key)}`), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ value }),
  });
  if (!response.ok) {
    const json = await response.json().catch(() => null);
    throw new Error(typeof json === "object" && json && "error" in json
      ? String((json as { error: string }).error)
      : `HTTP ${response.status}`);
  }
}

export async function deleteSecret(key: SecretKey): Promise<void> {
  const response = await fetch(apiUrl(`/secrets/${encodeURIComponent(key)}`), {
    method: "DELETE",
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

// --- Hooks ---
export interface HookStatus {
  repo_id: string;
  repo_path: string;
  git_dir: string;
  hook_path: string;
  exists: boolean;
  managed: boolean;
  points_to_backlog_bin: boolean;
}
export interface HooksOverview {
  workspace_paused_until: string | null;
  hooks: HookStatus[];
}

export async function fetchHooksStatus(): Promise<HooksOverview> {
  const response = await fetch(apiUrl("/hooks/status"));
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as HooksOverview;
}
