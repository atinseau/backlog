import { EventEmitter } from "node:events";
import { existsSync, watch, type FSWatcher } from "node:fs";
import { join } from "node:path";

export type BoardEventType =
  | "claim.changed"
  | "task.changed"
  | "work_item.changed"
  | "run.changed"
  | "project.changed"
  | "orchestrator.changed"
  | "repo.changed"
  | "board.refresh";

export interface BoardEvent {
  type: BoardEventType;
  ts: string;
}

interface WatchSpec {
  relative: string;
  type: BoardEventType;
  recursive?: boolean;
}

const WATCH_TARGETS: WatchSpec[] = [
  { relative: "claims/active", type: "claim.changed", recursive: true },
  { relative: "runs/active", type: "run.changed", recursive: true },
  { relative: "subtasks.yaml", type: "task.changed" },
  { relative: "tasks.yaml", type: "work_item.changed" },
  { relative: "projects.yaml", type: "project.changed" },
  { relative: "orchestrator.json", type: "orchestrator.changed" },
  { relative: "config.toml", type: "repo.changed" },
];

const DEBOUNCE_MS = 200;

export class EventBus extends EventEmitter {
  private watchers: FSWatcher[] = [];
  private debouncers = new Map<BoardEventType, NodeJS.Timeout>();

  start(backlogDir: string): void {
    if (this.watchers.length > 0) return;
    for (const spec of WATCH_TARGETS) {
      const target = join(backlogDir, spec.relative);
      if (!existsSync(target)) continue;
      try {
        const watcher = watch(target, { recursive: spec.recursive ?? false }, () => {
          this.scheduleEmit(spec.type);
        });
        watcher.on("error", () => this.scheduleEmit("board.refresh"));
        this.watchers.push(watcher);
      } catch {
        // Recursive watch unsupported on some filesystems; ignore — polling still keeps UI consistent.
      }
    }
  }

  stop(): void {
    for (const watcher of this.watchers) watcher.close();
    this.watchers = [];
    for (const handle of this.debouncers.values()) clearTimeout(handle);
    this.debouncers.clear();
  }

  private scheduleEmit(type: BoardEventType): void {
    const existing = this.debouncers.get(type);
    if (existing) clearTimeout(existing);
    const handle = setTimeout(() => {
      this.debouncers.delete(type);
      this.emitBoard({ type, ts: new Date().toISOString() });
    }, DEBOUNCE_MS);
    this.debouncers.set(type, handle);
  }

  emitBoard(event: BoardEvent): void {
    this.emit("event", event);
  }

  onBoard(listener: (event: BoardEvent) => void): () => void {
    this.on("event", listener);
    return () => this.off("event", listener);
  }
}
