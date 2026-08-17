import type {
  AgentAuthMode,
  AgentSummary,
  BoardResponse,
  ClaimRecord,
  CurrentProject,
  OrchestratorState,
  Repository,
  ProjectEntry,
  ProjectInfo,
  ProviderSummary,
  RunSummary,
  Conversation,
  ConversationSummary,
} from "./types.js";
import { repositoryDisplayName } from "./repository-display.js";

// Re-export so callers that already pull from this module (e.g. SplitDialog
// importing splitTask + AgentSummary in one block) don't have to dual-import
// from ./types.js. ProjectEntry / CurrentProject are heavily used by the
// project-switcher views; SettingsView and ProjectsView import them from
// here, hence the re-export.
export type {
  AgentSummary,
  ProjectEntry,
  CurrentProject,
  ProjectInfo,
  ProviderSummary,
  Conversation,
  ConversationSummary,
  ChatTranscriptMessage,
  ChatToolCall,
  ChatUsage,
} from "./types.js";

const BASE = "/api/v1";

function compareLabel(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

export function sortProjectEntries<T extends Pick<ProjectEntry, "id" | "name" | "path">>(projects: T[]): T[] {
  return projects.slice().sort((a, b) =>
    compareLabel(a.name || a.id, b.name || b.id)
    || compareLabel(a.path || "", b.path || "")
    || compareLabel(a.id, b.id),
  );
}

export function sortRepositories<T extends Pick<Repository, "id" | "path" | "checkout_path" | "remote_url" | "name">>(repositories: T[]): T[] {
  return repositories.slice().sort((a, b) =>
    compareLabel(repositoryDisplayName(a), repositoryDisplayName(b))
    || compareLabel(a.id, b.id),
  );
}

function sortGitRepositories<T extends { repo: string }>(repositories: T[]): T[] {
  return repositories.slice().sort((a, b) => compareLabel(a.repo, b.repo));
}

// Active project id used by every api.ts call. App.svelte sets it on mount
// and on user selection in the ProjectSelector.
let currentProjectId: string | null = null;

export function setCurrentProjectId(id: string | null): void {
  currentProjectId = id;
}

export function getCurrentProjectId(): string | null {
  return currentProjectId;
}

export function apiUrl(path: string, query: Record<string, string | undefined> = {}): string {
  const url = new URL(`${BASE}${path}`, window.location.origin);
  if (currentProjectId) url.searchParams.set("project", currentProjectId);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  return url.toString();
}

export async function fetchBoard(opts: { repo?: string } = {}): Promise<BoardResponse> {
  const response = await fetch(apiUrl("/board", { repository: opts.repo }));
  if (!response.ok) {
    throw new Error(`Board fetch failed: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as BoardResponse;
}

// Projects (registry) -------------------------------------------------------

export async function fetchProjectsList(): Promise<ProjectEntry[]> {
  const response = await fetch(apiUrl("/projects"));
  if (!response.ok) throw new Error(`Projects fetch failed: ${response.status}`);
  const json = (await response.json()) as { projects: ProjectEntry[] };
  return sortProjectEntries(json.projects);
}

export async function fetchCurrentProject(): Promise<CurrentProject> {
  const response = await fetch(apiUrl("/projects/current"));
  if (!response.ok) throw new Error(`Current project fetch failed: ${response.status}`);
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
    throw new Error(`Register project failed (${response.status}): ${detail}`);
  }
  const json = (await response.json()) as { project: ProjectEntry };
  return json.project;
}

export interface InitProjectInput {
  path: string;
  name: string;
  git_url?: string;
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

export interface GitRemoteBranches {
  branches: string[];
  default_branch: string | null;
}

export async function fetchGitRemoteBranches(url: string): Promise<GitRemoteBranches> {
  const response = await fetch(apiUrl("/projects/git/branches", { url }));
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof json === "object" && json && "message" in json
      ? String((json as { message: string }).message)
      : `HTTP ${response.status}`);
  }
  return json as GitRemoteBranches;
}

export async function unregisterProjectById(id: string): Promise<void> {
  const response = await fetch(apiUrl(`/projects/${encodeURIComponent(id)}`), { method: "DELETE" });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Unregister project failed (${response.status}): ${detail}`);
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
    throw new Error(`Touch project failed (${response.status}): ${detail}`);
  }
}

// Permissions / agents / project --------------------------------------------

// Conversations ------------------------------------------------------------

export async function fetchConversations(query?: string): Promise<ConversationSummary[]> {
  const path = query?.trim() ? `/conversations?q=${encodeURIComponent(query.trim())}` : "/conversations";
  const response = await fetch(apiUrl(path));
  if (!response.ok) throw new Error(`Conversations fetch failed: ${response.status}`);
  return ((await response.json()) as { conversations: ConversationSummary[] }).conversations;
}

export async function fetchConversation(id: string): Promise<Conversation> {
  const response = await fetch(apiUrl(`/conversations/${encodeURIComponent(id)}`));
  if (!response.ok) throw new Error(`Conversation fetch failed: ${response.status}`);
  return ((await response.json()) as { conversation: Conversation }).conversation;
}

export async function createConversation(title?: string): Promise<Conversation> {
  const response = await fetch(apiUrl("/conversations"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(title ? { title } : {}),
  });
  if (!response.ok) throw new Error(`Create conversation failed: ${response.status}`);
  return ((await response.json()) as { conversation: Conversation }).conversation;
}

export async function truncateConversation(id: string, keep: number): Promise<Conversation> {
  const response = await fetch(apiUrl(`/conversations/${encodeURIComponent(id)}/truncate`), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ keep }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Rewind failed (${response.status}): ${detail}`);
  }
  return ((await response.json()) as { conversation: Conversation }).conversation;
}

export async function patchConversation(
  id: string,
  patch: { title?: string; session_id?: string | null; model?: string | null },
): Promise<Conversation> {
  const response = await fetch(apiUrl(`/conversations/${encodeURIComponent(id)}`), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Update conversation failed (${response.status}): ${detail}`);
  }
  return ((await response.json()) as { conversation: Conversation }).conversation;
}

export async function deleteConversation(id: string): Promise<void> {
  const response = await fetch(apiUrl(`/conversations/${encodeURIComponent(id)}`), { method: "DELETE" });
  if (!response.ok) throw new Error(`Delete conversation failed: ${response.status}`);
}

export interface ChatBackendStatus {
  available: boolean;
  backend: string | null;
  detail?: string;
}

export async function fetchChatStatus(): Promise<ChatBackendStatus> {
  const response = await fetch(apiUrl("/orchestrator/chat/status"));
  if (!response.ok) throw new Error(`Chat status failed: ${response.status}`);
  return (await response.json()) as ChatBackendStatus;
}

export async function fetchProviders(): Promise<ProviderSummary[]> {
  const response = await fetch(apiUrl("/providers"));
  if (!response.ok) throw new Error(`Providers fetch failed: ${response.status}`);
  const json = (await response.json()) as { providers: ProviderSummary[] };
  return json.providers;
}

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
  auth_mode?: AgentAuthMode | null;
  success_mode?: "review" | "complete" | null;
  allowed_repos?: string[];
  allowed_risk?: Array<"low" | "medium" | "high">;
  capabilities?: string[];
  model?: string | null;
  profile?: string | null;
  // null clears it (the auto-computed name takes over again).
  display_name?: string | null;
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
  /** A provider id from GET /providers. Open on purpose: new runtimes need no client change. */
  provider: string;
  model?: string;
  profile?: string;
  command?: string;
  enabled?: boolean;
  sandbox_mode?: "read-only" | "workspace-write" | "danger-full-access";
  auth_mode?: AgentAuthMode;
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

export async function createUser(input: InviteUserInput): Promise<import("./types.js").UserSummary> {
  const response = await fetch(apiUrl("/users"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Create user failed (${response.status}): ${detail}`);
  }
  const json = (await response.json()) as { user: import("./types.js").UserSummary };
  return json.user;
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

export async function fetchProject(): Promise<ProjectInfo> {
  const response = await fetch(apiUrl("/project"));
  if (!response.ok) throw new Error(`Project fetch failed: ${response.status}`);
  const json = (await response.json()) as { project: ProjectInfo };
  return json.project;
}

/** @deprecated Use fetchProject. */
export async function setAutonomyMode(mode: ProjectInfo["autonomy_mode"]): Promise<void> {
  const response = await fetch(apiUrl("/project/autonomy"), {
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
  const response = await fetch(apiUrl("/project/claims"), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Claims config update failed (${response.status}): ${detail}`);
  }
}

export interface BoardConfig {
  show_backlog_column?: boolean;
}

export async function setBoardConfig(input: BoardConfig): Promise<{ board: { show_backlog_column: boolean } }> {
  const response = await fetch(apiUrl("/project/board"), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Board config update failed (${response.status}): ${detail}`);
  }
  return (await response.json()) as { board: { show_backlog_column: boolean } };
}

export interface ReviewConfig {
  show_review_column?: boolean;
  auto_reviewer_agent_id?: string | null;
}

export async function setReviewConfig(input: ReviewConfig): Promise<{ review: { show_review_column: boolean; auto_reviewer_agent_id?: string } }> {
  const response = await fetch(apiUrl("/project/review"), {
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

// Repositories --------------------------------------------------------------

export async function fetchRepositories(): Promise<Repository[]> {
  const response = await fetch(apiUrl("/repositories"));
  if (!response.ok) throw new Error(`Repositories fetch failed: ${response.status}`);
  const json = (await response.json()) as { repositories?: Repository[]; repos?: Repository[] };
  return sortRepositories(json.repositories ?? json.repos ?? []);
}

export interface CreateRepositoryInput {
  id?: string;
  path?: string;
  default_branch?: string;
  role?: string;
  enabled?: boolean;
  access_mode?: import("./types.js").RepositoryAccessMode;
  location?: import("./types.js").RepositoryLocation;
  remote_type?: import("./types.js").RepositoryRemoteType;
  remote_provider?: import("./types.js").RepositoryRemoteProvider;
  remote_url?: string;
  git_url?: string;
  provider?: import("./types.js").RepositoryProvider;
  clone_into?: string;
  checkout?: boolean;
}

export async function createRepository(input: CreateRepositoryInput): Promise<{ repo: Repository; cloned: boolean }> {
  const response = await fetch(apiUrl("/repositories"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Create repository failed (${response.status}): ${detail}`);
  }
  const json = (await response.json()) as { repository?: Repository; repo?: Repository; cloned: boolean };
  return { repo: json.repository ?? json.repo!, cloned: json.cloned };
}

export async function checkoutRepository(id: string, input: { path?: string; use_ssh?: boolean } = {}): Promise<{ repo: Repository; cloned: boolean }> {
  const response = await fetch(apiUrl(`/repositories/${encodeURIComponent(id)}/checkout`), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Create checkout failed (${response.status}): ${detail}`);
  }
  const json = (await response.json()) as { repository?: Repository; repo?: Repository; cloned: boolean };
  return { repo: json.repository ?? json.repo!, cloned: json.cloned };
}

export interface UpdateRepositoryInput {
  id?: string;
  path?: string;
  default_branch?: string;
  role?: string | null;
  enabled?: boolean;
  access_mode?: import("./types.js").RepositoryAccessMode;
  location?: import("./types.js").RepositoryLocation;
  remote_type?: import("./types.js").RepositoryRemoteType | null;
  remote_provider?: import("./types.js").RepositoryRemoteProvider | null;
  remote_url?: string | null;
  git_url?: string | null;
  provider?: import("./types.js").RepositoryProvider | null;
}

export async function updateRepository(id: string, input: UpdateRepositoryInput): Promise<Repository> {
  const response = await fetch(apiUrl(`/repositories/${encodeURIComponent(id)}`), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Update repository failed (${response.status}): ${detail}`);
  }
  const json = (await response.json()) as { repository?: Repository; repo?: Repository };
  return json.repository ?? json.repo!;
}

export async function deleteRepository(id: string, options: { force?: boolean } = {}): Promise<void> {
  const response = await fetch(
    apiUrl(`/repositories/${encodeURIComponent(id)}`, options.force ? { force: "1" } : {}),
    { method: "DELETE" },
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Delete repository failed (${response.status}): ${detail}`);
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
  status?: "backlog" | "ready" | "in_progress" | "review" | "test" | "released" | "done" | "blocked";
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
  planner_agent_id?: string;
  max_subagents?: number;
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

// "Move to top of the column" — reorder with no anchor falls through
// to insertIndex=0 in the core helper. Surfaces in the card menu as
// "Bypass queue" since the orchestrator picks higher-ranked items first.
export async function moveTaskToTop(id: string): Promise<void> {
  return reorderTask(id, {});
}

export async function archiveTask(id: string): Promise<void> {
  const response = await fetch(apiUrl(`/tasks/${encodeURIComponent(id)}/archive`), { method: "POST" });
  if (!response.ok) {
    throw new Error(`Archive failed (${response.status}): ${await response.text().catch(() => "")}`);
  }
}

export async function unarchiveTask(id: string): Promise<void> {
  const response = await fetch(apiUrl(`/tasks/${encodeURIComponent(id)}/unarchive`), { method: "POST" });
  if (!response.ok) {
    throw new Error(`Unarchive failed (${response.status}): ${await response.text().catch(() => "")}`);
  }
}

export async function deleteTask(id: string, opts: { cascade?: boolean } = {}): Promise<void> {
  const url = apiUrl(`/tasks/${encodeURIComponent(id)}`, opts.cascade ? { cascade: "true" } : {});
  const response = await fetch(url, { method: "DELETE" });
  if (!response.ok) {
    throw new Error(`Delete failed (${response.status}): ${await response.text().catch(() => "")}`);
  }
}

export async function archiveSubTask(id: string): Promise<void> {
  const response = await fetch(apiUrl(`/subtasks/${encodeURIComponent(id)}/archive`), { method: "POST" });
  if (!response.ok) {
    throw new Error(`Archive failed (${response.status}): ${await response.text().catch(() => "")}`);
  }
}

export async function unarchiveSubTask(id: string): Promise<void> {
  const response = await fetch(apiUrl(`/subtasks/${encodeURIComponent(id)}/unarchive`), { method: "POST" });
  if (!response.ok) {
    throw new Error(`Unarchive failed (${response.status}): ${await response.text().catch(() => "")}`);
  }
}

export async function deleteSubTask(id: string): Promise<void> {
  const response = await fetch(apiUrl(`/subtasks/${encodeURIComponent(id)}`), { method: "DELETE" });
  if (!response.ok) {
    throw new Error(`Delete failed (${response.status}): ${await response.text().catch(() => "")}`);
  }
}

// Partial update for tasks (priority, title, description, labels,
// repo_targets, execution defaults). Used by small UI actions such as
// priority, assignment, and switching a blocked direct task to a
// worktree.
export interface PatchTaskInput {
  title?: string;
  description?: string;
  priority?: "P0" | "P1" | "P2" | "P3";
  labels?: string[];
  repo_targets?: string[];
  // Default assignee for new sub-tasks. The card menu's Assign ▸
  // submenu writes a single id here (use [] to unassign).
  preferred_agents?: string[];
  worktree_mode?: "isolated_worktree" | "direct";
}
export async function patchTask(id: string, input: PatchTaskInput): Promise<void> {
  const response = await fetch(apiUrl(`/tasks/${encodeURIComponent(id)}`), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(`Patch failed (${response.status}): ${await response.text().catch(() => "")}`);
  }
}

export interface RefinedTaskResult {
  task: TaskDetail;
  model: string;
}

export async function refineTask(id: string): Promise<RefinedTaskResult> {
  const response = await fetch(apiUrl(`/tasks/${encodeURIComponent(id)}/refine`), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof json === "object" && json && "detail" in json
      ? String((json as { detail: string }).detail)
      : `Refine failed (${response.status})`);
  }
  return json as RefinedTaskResult;
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

export interface CliStatus {
  available: boolean;
  path: string | null;
  version: string | null;
  update_command: string;
  error?: string;
}

export interface HealthResponse {
  ok: boolean;
  project: string;
  version: string;
  app_version?: string;
  server_version?: string;
  cli?: CliStatus;
}

export async function fetchHealth(opts: { refreshCli?: boolean } = {}): Promise<HealthResponse> {
  const response = await fetch(apiUrl("/health", { refresh_cli: opts.refreshCli ? "1" : undefined }));
  if (!response.ok) throw new Error(`Health failed: ${response.status}`);
  return response.json();
}

export interface CliUpdateResponse {
  ok: boolean;
  command: string;
  manager_path: string | null;
  status: CliStatus;
  stdout?: string;
  stderr?: string;
  error?: string;
}

export async function updateBacklogCli(): Promise<CliUpdateResponse> {
  const response = await fetch(apiUrl("/cli/update"), { method: "POST" });
  const json = (await response.json().catch(() => null)) as CliUpdateResponse | null;
  if (!response.ok) {
    throw new Error(json?.error ?? `CLI update failed (${response.status})`);
  }
  if (!json) throw new Error("CLI update failed");
  return json;
}

export async function moveTask(id: string, to: string): Promise<void> {
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
  target_type: "task" | "subtask";
  target_id: string;
  subtask_id: string;
  // The parent task (task) the subtask belongs to.
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
  project: string;
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
  task: unknown;
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
  reasoning_effort?: string;
  approve?: boolean;
  allow_dirty_direct?: boolean;
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
  waiting: Array<{ target_type?: "task" | "subtask"; target_id?: string; subtask_id?: string; reasons: string[] }>;
  blocked: Array<{ target_type?: "task" | "subtask"; target_id?: string; subtask_id?: string; reasons: string[] }>;
}

export interface RunOwner {
  id: string;
  display_name?: string | null;
  provider: string;
  model?: string | null;
  profile?: string | null;
}

export interface RunTaskInfo {
  id: string;
  title: string;
  status: string;
  priority?: string;
  labels?: string[];
  repo_targets?: string[];
}

export interface RunSubTaskInfo {
  id: string;
  title: string;
  status: string;
  scopes: string[];
  claim_mode: "exclusive" | "shared";
  risk: "low" | "medium" | "high";
  priority_score: number;
  preferred_agents?: string[];
  manual_approval_required?: boolean;
}

export interface EnrichedRun {
  version: 1;
  id: string;
  target_type?: "task" | "subtask";
  target_id?: string;
  subtask_id?: string;
  task_id: string;
  repo: string;
  branch: string;
  agent_id: string;
  provider: string;
  reasoning_effort?: string;
  status: string;
  claim_ids: string[];
  execution_mode: "isolated_worktree" | "direct";
  worktree_path: string;
  artifacts: Array<{ kind: string; value: string }>;
  result: string | null;
  started_at?: string;
  finished_at?: string;
  active: boolean;
  task: RunTaskInfo | null;
  subtask: RunSubTaskInfo | null;
  owner: RunOwner;
  claims: ClaimRecord[];
  protected_paths: string[];
  planned_paths: string[];
  protects_repository: boolean;
  handoff_path: string | null;
  events: Array<Record<string, unknown>>;
}

export async function fetchRuns(opts: { scope?: "active" | "archived" | "all" } = {}): Promise<EnrichedRun[]> {
  const response = await fetch(apiUrl("/runs", { scope: opts.scope }));
  if (!response.ok) throw new Error(`Runs fetch failed: ${response.status}`);
  const json = (await response.json()) as { runs: EnrichedRun[] };
  return json.runs;
}

export interface UsageTotals {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  cost_usd: number;
  unknown_model_tokens: number;
}

export interface UsageModelSummary {
  model: string;
  totals: UsageTotals;
  total_tokens: number;
}

export interface UsageTimelinePoint {
  bucket: string;
  totals: UsageTotals;
  total_tokens: number;
}

export interface UsageRunSummary {
  run_id: string;
  totals: UsageTotals;
  total_tokens: number;
  models: string[];
}

export interface UsageResponse {
  generated_at: string;
  period: "7d" | "30d" | "90d" | "12m" | "all";
  bucket: "day" | "week" | "month";
  since: string | null;
  totals: UsageTotals;
  by_model: UsageModelSummary[];
  timeline: UsageTimelinePoint[];
  runs: UsageRunSummary[];
}

export async function fetchUsage(opts: {
  period?: UsageResponse["period"];
  bucket?: UsageResponse["bucket"];
} = {}): Promise<UsageResponse> {
  const response = await fetch(apiUrl("/usage", {
    period: opts.period,
    bucket: opts.bucket,
  }));
  if (!response.ok) throw new Error(`Usage fetch failed: ${response.status}`);
  return (await response.json()) as UsageResponse;
}

export interface InstructionFile {
  scope: "project" | "repository";
  repository_id?: string;
  repository_name?: string;
  root: string;
  path: string;
  relative_path: string;
  name: string;
  size_bytes: number;
  updated_at: string;
  content: string;
  truncated: boolean;
}

export interface InstructionsResponse {
  generated_at: string;
  files: InstructionFile[];
}

export async function fetchInstructions(): Promise<InstructionsResponse> {
  const response = await fetch(apiUrl("/instructions"));
  if (!response.ok) throw new Error(`Instructions fetch failed: ${response.status}`);
  return (await response.json()) as InstructionsResponse;
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
  content?: string;
  content_empty?: boolean;
  view?: "content" | "diff";
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

export async function discardRun(runId: string, summary?: string): Promise<void> {
  const response = await fetch(apiUrl(`/runs/${encodeURIComponent(runId)}/discard`), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(summary ? { summary } : {}),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(
      typeof detail === "object" && detail && "detail" in detail
        ? `Discard failed: ${(detail as { detail: string }).detail}`
        : `Discard failed: ${response.status}`,
    );
  }
}

export type RunApproveOptions = {
  summary?: string;
  merge_strategy?: "none" | "fast_forward" | "merge_commit";
};

export async function approveRun(runId: string, options?: string | RunApproveOptions): Promise<void> {
  const body = typeof options === "string" ? { summary: options } : (options ?? {});
  const response = await fetch(apiUrl(`/runs/${runId}/approve`), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(
      typeof detail === "object" && detail && "detail" in detail
        ? (detail as { detail: string }).detail
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

export interface SuggestSplitInput {
  max_subagents?: number;
  planner_prompt?: string;
  planner_agent_id?: string;
}

export async function suggestSplit(workItemId: string, input: SuggestSplitInput = {}): Promise<SuggestSplitResult> {
  const response = await fetch(apiUrl(`/tasks/${encodeURIComponent(workItemId)}/suggest-split`), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
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
  maxSubagents?: number,
): Promise<SplitResult> {
  const response = await fetch(apiUrl(`/tasks/${encodeURIComponent(workItemId)}/apply-split`), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tasks, force, ...(maxSubagents !== undefined ? { max_subagents: maxSubagents } : {}) }),
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
      repository: opts.repo,
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
  latest_run?: RunSummary | null;
  execution?: {
    lane?: string;
    preferred_agents: string[];
    required_capabilities: string[];
    manual_approval_required: boolean;
  };
  planner?: {
    origin?: "manual" | "split" | "imported" | "implicit";
    locked?: boolean;
    last_planned_at?: string;
  };
}

export async function fetchTaskDetail(id: string): Promise<{ task: TaskDetail; subtasks: SubTaskDetail[] }> {
  const response = await fetch(apiUrl(`/tasks/${encodeURIComponent(id)}`));
  if (!response.ok) {
    throw new Error(`Task fetch failed: ${response.status}`);
  }
  return (await response.json()) as { task: TaskDetail; subtasks: SubTaskDetail[] };
}

export async function fetchCommits(limit = 50, repo?: string | null, offset = 0): Promise<CommitEntry[]> {
  const response = await fetch(apiUrl("/commits", {
    limit: String(limit),
    ...(offset > 0 ? { offset: String(offset) } : {}),
    ...(repo ? { repository: repo } : {}),
  }));
  if (!response.ok) throw new Error(`Commits fetch failed: ${response.status}`);
  const json = (await response.json()) as { commits: CommitEntry[] };
  return json.commits;
}

export interface GitChangeEntry {
  path: string;
  old_path?: string;
  kind: "added" | "modified" | "deleted" | "renamed" | "untracked" | "conflicted";
  index_status: string;
  working_tree_status: string;
  staged: boolean;
  unstaged: boolean;
}

export interface GitRepoChanges {
  repo: string;
  path: string;
  status: import("./types.js").GitStatusSummary;
  changes: GitChangeEntry[];
}

export interface GitCommitFileEntry {
  path: string;
  old_path?: string;
  kind: "added" | "modified" | "deleted" | "renamed";
}

export async function fetchGitChanges(repo?: string | null): Promise<GitRepoChanges[]> {
  const response = await fetch(apiUrl("/git/changes", repo ? { repository: repo } : {}));
  if (!response.ok) throw new Error(`Git changes fetch failed: ${response.status}`);
  const json = (await response.json()) as { repositories?: GitRepoChanges[]; repos?: GitRepoChanges[] };
  return sortGitRepositories(json.repositories ?? json.repos ?? []);
}

export async function commitGitChanges(input: { repo: string; paths: string[]; message: string }): Promise<{ sha: string; short_sha: string }> {
  const response = await fetch(apiUrl("/git/commit"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof json === "object" && json && "detail" in json ? String((json as { detail: string }).detail) : "";
    const error = typeof json === "object" && json && "error" in json ? String((json as { error: string }).error) : `HTTP ${response.status}`;
    throw new Error(detail ? `${error}: ${detail}` : error);
  }
  return json as { sha: string; short_sha: string };
}

export async function discardGitChanges(input: { repo: string; paths: string[] }): Promise<{ discarded: number }> {
  const response = await fetch(apiUrl("/git/discard"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof json === "object" && json && "detail" in json ? String((json as { detail: string }).detail) : "";
    const error = typeof json === "object" && json && "error" in json ? String((json as { error: string }).error) : `HTTP ${response.status}`;
    throw new Error(detail ? `${error}: ${detail}` : error);
  }
  return json as { discarded: number };
}

export async function stashGitChanges(input: { repo: string; paths: string[]; message?: string }): Promise<{ stashed: number; message: string }> {
  const response = await fetch(apiUrl("/git/stash"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof json === "object" && json && "detail" in json ? String((json as { detail: string }).detail) : "";
    const error = typeof json === "object" && json && "error" in json ? String((json as { error: string }).error) : `HTTP ${response.status}`;
    throw new Error(detail ? `${error}: ${detail}` : error);
  }
  return json as { stashed: number; message: string };
}

export async function ignoreGitChanges(input: { repo: string; paths: string[] }): Promise<{ ignored: number; patterns_added: number; gitignore_path: string }> {
  const response = await fetch(apiUrl("/git/ignore"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof json === "object" && json && "detail" in json ? String((json as { detail: string }).detail) : "";
    const error = typeof json === "object" && json && "error" in json ? String((json as { error: string }).error) : `HTTP ${response.status}`;
    throw new Error(detail ? `${error}: ${detail}` : error);
  }
  return json as { ignored: number; patterns_added: number; gitignore_path: string };
}

export async function ensureGitIgnore(repo: string): Promise<{ path: string }> {
  const response = await fetch(apiUrl("/git/gitignore"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ repo }),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof json === "object" && json && "detail" in json ? String((json as { detail: string }).detail) : "";
    const error = typeof json === "object" && json && "error" in json ? String((json as { error: string }).error) : `HTTP ${response.status}`;
    throw new Error(detail ? `${error}: ${detail}` : error);
  }
  return json as { path: string };
}

export async function initGitRepository(repo: string): Promise<{ state: GitRepoBranches }> {
  const response = await fetch(apiUrl("/git/init"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ repo }),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof json === "object" && json && "detail" in json ? String((json as { detail: string }).detail) : "";
    const error = typeof json === "object" && json && "error" in json ? String((json as { error: string }).error) : `HTTP ${response.status}`;
    throw new Error(detail ? `${error}: ${detail}` : error);
  }
  return json as { state: GitRepoBranches };
}

export interface GitFileDiff {
  repo: string;
  file: string;
  sha?: string;
  base?: string;
  head?: string;
  diff: string;
  empty: boolean;
  kind: GitChangeEntry["kind"] | GitCommitFileEntry["kind"] | null;
}

export async function fetchGitCommitFiles(repo: string, sha: string): Promise<{ repo: string; sha: string; files: GitCommitFileEntry[] }> {
  const response = await fetch(apiUrl("/git/commit-files", { repository: repo, sha }));
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof json === "object" && json && "detail" in json ? String((json as { detail: string }).detail) : "";
    throw new Error(detail || `Git commit files failed: ${response.status}`);
  }
  return json as { repo: string; sha: string; files: GitCommitFileEntry[] };
}

export async function fetchGitFileDiff(repo: string, file: string, opts: { sha?: string; base?: string; head?: string } = {}): Promise<GitFileDiff> {
  const response = await fetch(apiUrl("/git/diff", { repository: repo, file, ...opts }), { cache: "no-store" });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof json === "object" && json && "detail" in json ? String((json as { detail: string }).detail) : "";
    throw new Error(detail || `Git diff failed: ${response.status}`);
  }
  return json as GitFileDiff;
}

export interface GitRemoteState {
  repo: string;
  branch: string | null;
  upstream: string | null;
  remote_url: string | null;
  ahead: number;
  behind: number;
  has_upstream: boolean;
  error?: string;
}

export interface GitBranchEntry {
  name: string;
  current: boolean;
  upstream?: string | null;
}

export interface GitRemoteBranchEntry {
  name: string;
  remote: string;
  short_name: string;
}

export interface GitRepoBranches {
  repo: string;
  path: string;
  has_local_checkout?: boolean;
  default_branch: string;
  current_branch: string | null;
  local: GitBranchEntry[];
  remote: GitRemoteBranchEntry[];
  error?: string;
}

export interface GitBranchPreview {
  repo: string;
  source: string;
  target: string;
  base: string;
  commits: CommitEntry[];
  files: GitCommitFileEntry[];
}

export interface GitWorktreeEntry {
  path: string;
  head: string | null;
  branch: string | null;
  detached: boolean;
  bare: boolean;
  prunable: boolean;
  prunable_reason?: string;
  main: boolean;
}

export interface GitRepoWorktrees {
  repo: string;
  path: string;
  worktrees: GitWorktreeEntry[];
  error?: string;
}

export async function fetchGitRemoteState(repo?: string | null): Promise<GitRemoteState[]> {
  const response = await fetch(apiUrl("/git/remote", repo ? { repository: repo } : {}));
  if (!response.ok) throw new Error(`Git remote fetch failed: ${response.status}`);
  const json = (await response.json()) as { repositories?: GitRemoteState[]; repos?: GitRemoteState[] };
  return sortGitRepositories(json.repositories ?? json.repos ?? []);
}

export async function fetchGitBranches(repo?: string | null): Promise<GitRepoBranches[]> {
  const response = await fetch(apiUrl("/git/branches", repo ? { repository: repo } : {}));
  if (!response.ok) throw new Error(`Git branches fetch failed: ${response.status}`);
  const json = (await response.json()) as { repositories?: GitRepoBranches[]; repos?: GitRepoBranches[] };
  return sortGitRepositories(json.repositories ?? json.repos ?? []);
}

export async function fetchGitBranchPreview(repo: string, source: string, target?: string | null): Promise<GitBranchPreview> {
  const response = await fetch(apiUrl("/git/branch-preview", { repository: repo, source, ...(target ? { target } : {}) }));
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof json === "object" && json && "detail" in json ? String((json as { detail: string }).detail) : "";
    throw new Error(detail || `Git branch preview failed: ${response.status}`);
  }
  return json as GitBranchPreview;
}

export async function checkoutGitBranch(input: {
  repo: string;
  branch: string;
  create?: boolean;
  start_point?: string;
}): Promise<{ state: GitRepoBranches }> {
  const response = await fetch(apiUrl("/git/checkout"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof json === "object" && json && "detail" in json ? String((json as { detail: string }).detail) : "";
    const error = typeof json === "object" && json && "error" in json ? String((json as { error: string }).error) : `HTTP ${response.status}`;
    throw new Error(detail ? `${error}: ${detail}` : error);
  }
  return json as { state: GitRepoBranches };
}

export async function fetchGitWorktrees(repo?: string | null): Promise<GitRepoWorktrees[]> {
  const response = await fetch(apiUrl("/git/worktrees", repo ? { repository: repo } : {}));
  if (!response.ok) throw new Error(`Git worktrees fetch failed: ${response.status}`);
  const json = (await response.json()) as { repositories?: GitRepoWorktrees[]; repos?: GitRepoWorktrees[] };
  return sortGitRepositories(json.repositories ?? json.repos ?? []);
}

export async function addGitWorktree(input: { repo: string; path: string; branch?: string }): Promise<{ worktrees: GitWorktreeEntry[] }> {
  const response = await fetch(apiUrl("/git/worktrees"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof json === "object" && json && "detail" in json ? String((json as { detail: string }).detail) : "";
    const error = typeof json === "object" && json && "error" in json ? String((json as { error: string }).error) : `HTTP ${response.status}`;
    throw new Error(detail ? `${error}: ${detail}` : error);
  }
  return json as { worktrees: GitWorktreeEntry[] };
}

export async function removeGitWorktree(input: { repo: string; path: string; force?: boolean }): Promise<{ worktrees: GitWorktreeEntry[] }> {
  const response = await fetch(apiUrl("/git/worktrees/remove"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof json === "object" && json && "detail" in json ? String((json as { detail: string }).detail) : "";
    const error = typeof json === "object" && json && "error" in json ? String((json as { error: string }).error) : `HTTP ${response.status}`;
    throw new Error(detail ? `${error}: ${detail}` : error);
  }
  return json as { worktrees: GitWorktreeEntry[] };
}

export async function pruneGitWorktrees(repo: string): Promise<{ worktrees: GitWorktreeEntry[] }> {
  const response = await fetch(apiUrl("/git/worktrees/prune"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ repo }),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof json === "object" && json && "detail" in json ? String((json as { detail: string }).detail) : "";
    const error = typeof json === "object" && json && "error" in json ? String((json as { error: string }).error) : `HTTP ${response.status}`;
    throw new Error(detail ? `${error}: ${detail}` : error);
  }
  return json as { worktrees: GitWorktreeEntry[] };
}

export async function mergeGitBranch(input: {
  repo: string;
  source: string;
  strategy: "auto" | "ff_only" | "no_ff";
}): Promise<{ sha: string; short_sha: string; state: GitRepoBranches }> {
  const response = await fetch(apiUrl("/git/merge"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof json === "object" && json && "detail" in json ? String((json as { detail: string }).detail) : "";
    const error = typeof json === "object" && json && "error" in json ? String((json as { error: string }).error) : `HTTP ${response.status}`;
    throw new Error(detail ? `${error}: ${detail}` : error);
  }
  return json as { sha: string; short_sha: string; state: GitRepoBranches };
}

export interface GitPullRequest {
  number: number;
  url: string;
  state: string;
  title: string;
  head: string;
  base: string;
}

export async function createGitPullRequest(input: {
  repo: string;
  source: string;
  target?: string;
  title?: string;
  body?: string;
}): Promise<{ pull_request: GitPullRequest; url: string }> {
  const response = await fetch(apiUrl("/git/pull-request"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof json === "object" && json && "detail" in json ? String((json as { detail: string }).detail) : "";
    const error = typeof json === "object" && json && "error" in json ? String((json as { error: string }).error) : `HTTP ${response.status}`;
    throw new Error(detail ? `${error}: ${detail}` : error);
  }
  return json as { pull_request: GitPullRequest; url: string };
}

export async function syncGitRepo(repo: string): Promise<{ actions: string[]; state: GitRemoteState }> {
  const response = await fetch(apiUrl("/git/sync"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ repo }),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof json === "object" && json && "detail" in json ? String((json as { detail: string }).detail) : "";
    const error = typeof json === "object" && json && "error" in json ? String((json as { error: string }).error) : `HTTP ${response.status}`;
    throw new Error(detail ? `${error}: ${detail}` : error);
  }
  return json as { actions: string[]; state: GitRemoteState };
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
  display_name?: string | null;
  initials?: string | null;
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
  /**
   * False when the server has no hosted account service configured — the
   * default here. The board then hides sign-in/billing entries instead of
   * offering actions that cannot complete.
   */
  available?: boolean;
}

export async function fetchCloudStatus(): Promise<CloudStatus> {
  const response = await fetch(apiUrl("/cloud/me"));
  return (await response.json()) as CloudStatus;
}

export interface CloudCredentials {
  email: string;
  password: string;
  display_name?: string;
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

export interface GithubRepositorySummary {
  full_name: string;
  description: string | null;
  private: boolean;
  default_branch: string;
  clone_url: string;
  ssh_url: string;
  html_url: string;
  pushed_at: string;
}

export async function listGithubRepositories(): Promise<GithubRepositorySummary[]> {
  const response = await fetch(apiUrl("/integrations/github/repositories"));
  const json = await response.json();
  if (!response.ok) {
    throw new Error(typeof json === "object" && json && "detail" in json
      ? (json as { detail: string }).detail
      : `HTTP ${response.status}`);
  }
  const body = json as { repositories?: GithubRepositorySummary[]; repos?: GithubRepositorySummary[] };
  return (body.repositories ?? body.repos ?? []).slice().sort((a, b) => compareLabel(a.full_name, b.full_name));
}

export async function cloneGithubRepository(input: {
  full_name: string;
  default_branch?: string;
  id?: string;
  use_ssh?: boolean;
  checkout?: boolean;
}): Promise<{ repo: Repository; cloned: boolean }> {
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
  return json as { repo: Repository; cloned: boolean };
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

// --- Folder inspector (used by the create-project / add-repository flows) ---
export interface FolderInspect {
  exists: boolean;
  is_directory: boolean;
  is_git_repo: boolean;
  has_backlog_dir: boolean;
  basename: string;
  current_branch: string | null;
  branches: string[];
}

export interface FolderListEntry {
  name: string;
  path: string;
  has_backlog_dir: boolean;
  is_git_repo: boolean;
}

export interface FolderList {
  path: string;
  parent: string | null;
  home: string;
  entries: FolderListEntry[];
}

export async function listFolders(absolutePath?: string): Promise<FolderList> {
  const response = await fetch(apiUrl("/folders/list", { path: absolutePath }));
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof json === "object" && json && "error" in json
      ? String((json as { error: string }).error)
      : `HTTP ${response.status}`);
  }
  return json as FolderList;
}

export async function inspectFolder(absolutePath: string): Promise<FolderInspect> {
  const response = await fetch(apiUrl("/folders/inspect", { path: absolutePath }));
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as FolderInspect;
}

// --- Secrets (API keys) ---
export type SecretKey = "ANTHROPIC_API_KEY" | "OPENAI_API_KEY";

export async function fetchSecretsList(): Promise<{ key: string; set: boolean; scope?: "project" | "account" | null }[]> {
  const response = await fetch(apiUrl("/secrets"));
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const json = (await response.json()) as { keys: { key: string; set: boolean; scope?: "project" | "account" | null }[] };
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
  installed_version: string | null;
  expected_version: string;
  points_to_backlog_bin: boolean;
  shim_up_to_date: boolean;
  up_to_date: boolean;
}
export interface HooksOverview {
  project_paused_until: string | null;
  hooks: HookStatus[];
}

export async function fetchHooksStatus(): Promise<HooksOverview> {
  const response = await fetch(apiUrl("/hooks/status"));
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as HooksOverview;
}

export async function installRepoHook(repoId: string, opts: { force?: boolean } = {}): Promise<HookStatus> {
  const response = await fetch(apiUrl("/hooks/install"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ repo_id: repoId, ...(opts.force ? { force: true } : {}) }),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text().catch(() => "")}`);
  }
  return (await response.json()) as HookStatus;
}

export async function uninstallRepoHook(repoId: string): Promise<HookStatus> {
  const response = await fetch(apiUrl("/hooks/uninstall"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ repo_id: repoId }),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text().catch(() => "")}`);
  }
  return (await response.json()) as HookStatus;
}
