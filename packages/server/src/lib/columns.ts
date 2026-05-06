import type { TaskStatus } from "@backlog/schemas";

export type ColumnKey = "backlog" | "todo" | "doing" | "review" | "done";

export const COLUMN_LABELS_FR: Record<ColumnKey, string> = {
  backlog: "Backlog",
  todo: "À faire",
  doing: "En cours",
  review: "In Review",
  done: "Done",
};

export const COLUMN_KEYS: ColumnKey[] = ["backlog", "todo", "doing", "review", "done"];

export function statusToColumn(status: TaskStatus): ColumnKey | null {
  switch (status) {
    case "backlog":
      return "backlog";
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

export function columnToDefaultStatus(column: ColumnKey): TaskStatus {
  switch (column) {
    case "backlog":
      return "backlog";
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
