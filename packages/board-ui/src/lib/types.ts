export type ColumnKey = "backlog" | "todo" | "doing" | "review" | "done";
export type Priority = "P0" | "P1" | "P2" | "P3";
export type OrchestratorMode = "idle" | "running" | "paused" | "stopping";

export interface ClaimSummary {
  id: string;
  topic: string;
  paths: string[];
  expires_at: string;
  blocking: boolean;
  expected_finish_at?: string | null;
  agent_id?: string | null;
}

export interface ClaimAgentInfo {
  id: string;
  provider: string;
  model?: string;
  profile?: string;
}

export interface ClaimRecord {
  id: string;
  repo: string;
  repo_path: string;
  paths: string[];
  mode: "exclusive" | "shared";
  status: "active" | "archived";
  topic: string;
  created_at: string;
  heartbeat_at: string;
  expires_at: string;
  finished_at?: string;
  expected_duration_seconds?: number;
  expected_finish_at?: string;
  agent_id?: string;
  agent?: ClaimAgentInfo;
  metadata?: Record<string, string>;
}

export interface RunSummary {
  id: string;
  status: string;
  agent_id: string;
  started_at?: string;
  finished_at?: string;
  execution_mode?: "isolated_worktree" | "direct";
  result?: string | null;
}

export interface SubTaskCard {
  id: string;
  title: string;
  repo: string;
  status: string;
  scopes: string[];
  blockers: string[];
  risk: "low" | "medium" | "high";
  priority_score: number;
  active_run: RunSummary | null;
  active_claim: ClaimSummary | null;
  estimated_duration_seconds: number;
  estimate_source: "manual" | "auto";
  elapsed_seconds: number | null;
  progress_percent: number;
  progress_source: "agent" | "elapsed" | "status";
  eta: string | null;
  latest_run: RunSummary | null;
}

export interface TaskCard {
  id: string;
  title: string;
  description?: string;
  priority: Priority;
  status: string;
  labels: string[];
  repo_targets: string[];
  rank: number | null;
  created_at: string;
  updated_at: string;
  tasks: SubTaskCard[];
  blocked_by_claims: ClaimSummary[];
  estimated_duration_seconds: number;
  remaining_seconds: number;
  progress_percent: number;
}

export interface GitStatusSummary {
  clean: boolean;
  total: number;
  added: number;
  modified: number;
  deleted: number;
  renamed: number;
  untracked: number;
  conflicted: number;
  staged: number;
  unstaged: number;
  error?: string;
}

export interface BoardResponse {
  generated_at: string;
  project: string;
  repo_git_statuses: Record<string, GitStatusSummary>;
  columns: Record<ColumnKey, TaskCard[]>;
  active_claims_count: number;
  active_runs_count: number;
  total_estimated_seconds: number;
  total_remaining_seconds: number;
}

export type RepositoryLocation = "local" | "remote";
export type RepositoryRemoteType = "git" | "ftp" | "sftp" | "other";
export type RepositoryRemoteProvider = "github" | "gitlab" | "bitbucket" | "custom" | "other";
export type RepositoryProvider = "local" | "github" | "gitlab" | "bitbucket" | "other";

export type AutonomyMode = "observe" | "assist" | "delegate" | "autopilot";

export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";

export interface AgentSummary {
  id: string;
  // User-set human label, surfaced in the topbar picker and the
  // Agents view. Null means "no override" — the UI computes a label
  // from provider + model via formatAgentLabel().
  display_name: string | null;
  provider: string;
  enabled: boolean;
  max_concurrent_runs: number;
  active_runs: number;
  capabilities: string[];
  allowed_repos: string[];
  allowed_risk: Array<"low" | "medium" | "high">;
  sandbox_mode: SandboxMode | null;
  success_mode: "review" | "complete" | null;
  model: string | null;
  profile: string | null;
  // Server-side credential probe — true when the executor needs an
  // API key the project doesn't currently have. The UI surfaces a
  // warning and grays the toggle so the user knows enabling it would
  // not actually let the orchestrator pick this agent.
  needs_api_key?: boolean;
  // Which secret key is missing (e.g. "ANTHROPIC_API_KEY"). null when
  // the provider doesn't require one (custom / manual).
  required_secret_key?: string | null;
}

export type UserRole = "owner" | "admin" | "member" | "guest";
export type UserStatus = "pending" | "active" | "removed";

export interface UserSummary {
  id: string;
  email: string;
  display_name: string;
  role: UserRole;
  status: UserStatus;
  invited_at: string;
  invited_by?: string;
  confirmed_at?: string;
  invitation_token?: string;
  invitation_expires_at?: string;
}

export interface ProjectInfo {
  id?: string;
  name: string;
  mode: "embedded" | "control_plane";
  default_branch: string;
  autonomy_mode: AutonomyMode;
  max_agents: number;
  claims: {
    ttl_minutes: number;
    enforce_on_commit: boolean;
    auto_claim_on_commit: boolean;
  };
  board?: {
    show_backlog_column: boolean;
  };
  review?: {
    show_review_column: boolean;
    auto_reviewer_agent_id?: string;
  };
}

export interface ProjectEntry {
  id: string;
  path: string;
  name: string;
  transient?: boolean;
  /**
   * Where the project lives relative to the path:
   *   "in_repo"     → <path>/.backlog/  (single-repo project)
   *   "user_level"  → <path> itself is the project root, registered
   *                   under ~/.backlog/<slug>/ (multi-repo project)
   *
   * Optional because older registries persisted before this field
   * existed don't carry it; the resolver falls back to "in_repo".
   */
  location?: "in_repo" | "user_level";
  added_at: string;
  last_opened_at?: string;
}

export interface CurrentProject {
  project_id?: string;
  root: string;
  backlog_dir: string;
  resolved_from: string;
  transient?: boolean;
  repo_only?: {
    root: string;
    repo_id: string;
    name: string;
    default_branch: string;
  } | null;
}

export type RepositoryAccessMode = "read-write" | "read-only" | "no-access";

export interface Repository {
  id: string;
  name?: string;
  path?: string;
  checkout_path?: string;
  path_exists?: boolean;
  has_local_checkout?: boolean;
  default_branch: string;
  role?: string;
  enabled: boolean;
  // Defaults to "read-write" server-side. Existing config.toml files
  // load with this default applied, so the field is always set on the
  // wire — but we mark it optional so older clients don't choke.
  access_mode?: RepositoryAccessMode;
  location?: RepositoryLocation;
  remote_type?: RepositoryRemoteType;
  remote_provider?: RepositoryRemoteProvider;
  remote_url?: string;
  // Deprecated compatibility fields.
  git_url?: string;
  provider?: RepositoryProvider;
}

export interface OrchestratorState {
  version: 1;
  mode: OrchestratorMode;
  max_agents: number;
  auto_pick_agents: boolean;
  tick_interval_ms: number;
  started_at?: string;
  paused_at?: string;
  last_tick_at?: string;
  last_started_count?: number;
  last_error?: string;
}

export const COLUMN_LABELS: Record<ColumnKey, string> = {
  backlog: "Backlog",
  todo: "À faire",
  doing: "En cours",
  review: "In Review",
  done: "Done",
};

export const COLUMN_ORDER: ColumnKey[] = ["backlog", "todo", "doing", "review", "done"];

export const COLUMN_DEFAULT_STATUS: Record<ColumnKey, string> = {
  backlog: "backlog",
  todo: "ready",
  doing: "in_progress",
  review: "review",
  done: "done",
};
