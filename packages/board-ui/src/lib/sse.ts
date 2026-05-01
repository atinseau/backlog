import { apiUrl } from "./api.js";

export type BoardEventType =
  | "ready"
  | "ping"
  | "claim.changed"
  | "subtask.changed"
  | "task.changed"
  | "run.changed"
  | "project.changed"
  | "orchestrator.changed"
  | "repo.changed"
  | "board.refresh";

export interface BoardSseClient {
  close: () => void;
}

export function subscribeToBoard(
  onEvent: (type: BoardEventType) => void,
  onConnectionChange?: (connected: boolean) => void,
): BoardSseClient {
  // apiUrl injects the active ?project=<id>, so SSE follows whatever the
  // user picked in the ProjectSelector. App.svelte tears down + recreates
  // this subscription on project change to point the EventSource at the
  // new project's bus.
  const source = new EventSource(apiUrl("/events"));
  const eventTypes: BoardEventType[] = [
    "ready",
    "ping",
    "claim.changed",
    "subtask.changed",
    "task.changed",
    "run.changed",
    "project.changed",
    "orchestrator.changed",
    "repo.changed",
    "board.refresh",
  ];

  source.onopen = () => onConnectionChange?.(true);
  source.onerror = () => onConnectionChange?.(false);

  for (const type of eventTypes) {
    source.addEventListener(type, () => onEvent(type));
  }

  return {
    close: () => source.close(),
  };
}
