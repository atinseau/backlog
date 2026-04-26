import { Hono } from "hono";
import type { ServerWorkspace } from "../workspace-context.js";

export function healthRoutes(workspace: ServerWorkspace, version: string): Hono {
  const app = new Hono();
  app.get("/health", (c) =>
    c.json({
      ok: true,
      version,
      workspace: workspace.root,
      backlogDir: workspace.backlogDir,
    }),
  );
  return app;
}
