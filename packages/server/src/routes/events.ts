import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { EventBusRegistry } from "../lib/event-bus-registry.js";
import type { AppEnv } from "../project-resolver.js";

const HEARTBEAT_MS = 25_000;

export function eventsRoutes(buses: EventBusRegistry): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/events", (c) => {
    const project = c.get("project");
    const bus = buses.get(project);
    return streamSSE(c, async (stream) => {
      let id = 0;
      await stream.writeSSE({
        event: "ready",
        id: String(id++),
        data: JSON.stringify({ ts: new Date().toISOString(), project_id: project.project_id }),
      });

      const unsubscribe = bus.onBoard(async (event) => {
        try {
          await stream.writeSSE({
            event: event.type,
            id: String(id++),
            data: JSON.stringify(event),
          });
        } catch {
          // client disconnected mid-write; cleanup runs in stream.onAbort
        }
      });

      const heartbeat = setInterval(() => {
        stream.writeSSE({
          event: "ping",
          id: String(id++),
          data: JSON.stringify({ ts: new Date().toISOString() }),
        }).catch(() => undefined);
      }, HEARTBEAT_MS);

      stream.onAbort(() => {
        clearInterval(heartbeat);
        unsubscribe();
      });

      // Keep the stream alive until the client disconnects.
      await new Promise<void>((resolve) => {
        stream.onAbort(resolve);
      });
    });
  });

  return app;
}
