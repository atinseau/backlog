export type ColumnKey = "todo" | "doing" | "review" | "done";
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
  started_at: string;
}

export interface SubTaskCard {
  id: string;
  title: string;
  repo: string;
  status: string;
  scopes: string[];
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
}

export interface WorkItemCard {
  id: string;
  title: string;
  priority: Priority;
  status: string;
  labels: string[];
  repo_targets: string[];
  rank: number | null;
  tasks: SubTaskCard[];
  blocked_by_claims: ClaimSummary[];
  estimated_duration_seconds: number;
  remaining_seconds: number;
  progress_percent: number;
}

export interface BoardResponse {
  generated_at: string;
  workspace: string;
  columns: Record<ColumnKey, WorkItemCard[]>;
  active_claims_count: number;
  active_runs_count: number;
  total_estimated_seconds: number;
  total_remaining_seconds: number;
}

export type RepoProvider = "local" | "github" | "gitlab" | "bitbucket" | "other";

export type AutonomyMode = "observe" | "assist" | "delegate" | "autopilot";

export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";

export interface AgentSummary {
  id: string;
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
  };
}

export interface ProjectEntry {
  id: string;
  path: string;
  name: string;
  added_at: string;
  last_opened_at?: string;
}

export interface CurrentProject {
  root: string;
  backlog_dir: string;
  resolved_from: string;
}

export interface Repo {
  id: string;
  path: string;
  default_branch: string;
  role?: string;
  enabled: boolean;
  git_url?: string;
  provider?: RepoProvider;
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
  todo: "À faire",
  doing: "En cours",
  review: "In Review",
  done: "Done",
};

export const COLUMN_ORDER: ColumnKey[] = ["todo", "doing", "review", "done"];

export const COLUMN_DEFAULT_STATUS: Record<ColumnKey, string> = {
  todo: "ready",
  doing: "in_progress",
  review: "review",
  done: "done",
};
