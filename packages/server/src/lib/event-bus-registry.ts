import type { ServerProject } from "../project-context.js";
import { EventBus } from "./event-bus.js";

// Lazy per-project EventBus pool. The Hono multi-project server can be
// asked for events on any registered project; we don't want to spin up
// (or keep) file watchers for projects nobody is watching, so each bus is
// created on first use and reused for the lifetime of the server.
export class EventBusRegistry {
  private readonly buses = new Map<string, EventBus>();

  get(project: ServerProject): EventBus {
    const existing = this.buses.get(project.project_id);
    if (existing) return existing;
    const bus = new EventBus();
    bus.start(project.backlogDir);
    this.buses.set(project.project_id, bus);
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
