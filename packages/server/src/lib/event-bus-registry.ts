import type { ServerWorkspace } from "../workspace-context.js";
import { EventBus } from "./event-bus.js";

// Lazy per-workspace EventBus pool. The Hono multi-workspace server can be
// asked for events on any registered workspace; we don't want to spin up
// (or keep) file watchers for workspaces nobody is watching, so each bus is
// created on first use and reused for the lifetime of the server.
export class EventBusRegistry {
  private readonly buses = new Map<string, EventBus>();

  get(workspace: ServerWorkspace): EventBus {
    const existing = this.buses.get(workspace.workspace_id);
    if (existing) return existing;
    const bus = new EventBus();
    bus.start(workspace.backlogDir);
    this.buses.set(workspace.workspace_id, bus);
    return bus;
  }

  has(workspaceId: string): boolean {
    return this.buses.has(workspaceId);
  }

  stopAll(): void {
    for (const bus of this.buses.values()) bus.stop();
    this.buses.clear();
  }
}
