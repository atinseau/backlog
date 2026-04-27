import { apiUrl } from "./api.js";

export type BoardEventType =
  | "ready"
  | "ping"
  | "claim.changed"
  | "task.changed"
  | "work_item.changed"
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
  // apiUrl injects the active ?workspace=<id>, so SSE follows whatever the
  // user picked in the WorkspaceSelector. App.svelte tears down + recreates
  // this subscription on workspace change to point the EventSource at the
  // new workspace's bus.
  const source = new EventSource(apiUrl("/events"));
  const eventTypes: BoardEventType[] = [
    "ready",
    "ping",
    "claim.changed",
    "task.changed",
    "work_item.changed",
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
