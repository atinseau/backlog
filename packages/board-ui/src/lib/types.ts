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

export interface RunSummary {
  id: string;
  status: string;
  agent_id: string;
  started_at: string;
}

export interface TaskCard {
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
  project_id: string | null;
  rank: number | null;
  tasks: TaskCard[];
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

export interface Project {
  id: string;
  slug: string;
  name: string;
  description?: string;
  color?: string;
  repo_ids: string[];
  max_agents?: number;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface Repo {
  id: string;
  path: string;
  default_branch: string;
  role?: string;
  enabled: boolean;
}

export interface OrchestratorState {
  version: 1;
  mode: OrchestratorMode;
  max_agents: number;
  auto_pick_agents: boolean;
  tick_interval_ms: number;
  project_id?: string;
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
