export type ColumnKey = "todo" | "doing" | "review" | "done";
export type Priority = "P0" | "P1" | "P2" | "P3";

export interface ClaimSummary {
  id: string;
  topic: string;
  paths: string[];
  expires_at: string;
  blocking: boolean;
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
  active_run: RunSummary | null;
  active_claim: ClaimSummary | null;
}

export interface WorkItemCard {
  id: string;
  title: string;
  priority: Priority;
  status: string;
  labels: string[];
  repo_targets: string[];
  tasks: TaskCard[];
  blocked_by_claims: ClaimSummary[];
}

export interface BoardResponse {
  generated_at: string;
  workspace: string;
  columns: Record<ColumnKey, WorkItemCard[]>;
  active_claims_count: number;
  active_runs_count: number;
}

export const COLUMN_LABELS: Record<ColumnKey, string> = {
  todo: "À faire",
  doing: "En cours",
  review: "In Review",
  done: "Done",
};

export const COLUMN_ORDER: ColumnKey[] = ["todo", "doing", "review", "done"];
