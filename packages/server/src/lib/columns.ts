import type { WorkStatus } from "@backlog/schemas";

export type ColumnKey = "todo" | "doing" | "review" | "done";

export const COLUMN_LABELS_FR: Record<ColumnKey, string> = {
  todo: "À faire",
  doing: "En cours",
  review: "In Review",
  done: "Done",
};

export const COLUMN_KEYS: ColumnKey[] = ["todo", "doing", "review", "done"];

export function statusToColumn(status: WorkStatus): ColumnKey | null {
  switch (status) {
    case "backlog":
    case "ready":
    case "blocked":
      return "todo";
    case "in_progress":
      return "doing";
    case "review":
    case "test":
      return "review";
    case "released":
    case "done":
      return "done";
    default:
      return null;
  }
}

export function columnToDefaultStatus(column: ColumnKey): WorkStatus {
  switch (column) {
    case "todo":
      return "ready";
    case "doing":
      return "in_progress";
    case "review":
      return "review";
    case "done":
      return "done";
  }
}
