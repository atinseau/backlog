export type BoardEventType =
  | "ready"
  | "ping"
  | "claim.changed"
  | "task.changed"
  | "work_item.changed"
  | "run.changed"
  | "board.refresh";

export interface BoardSseClient {
  close: () => void;
}

export function subscribeToBoard(
  onEvent: (type: BoardEventType) => void,
  onConnectionChange?: (connected: boolean) => void,
): BoardSseClient {
  const source = new EventSource("/api/v1/events");
  const eventTypes: BoardEventType[] = [
    "ready",
    "ping",
    "claim.changed",
    "task.changed",
    "work_item.changed",
    "run.changed",
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
