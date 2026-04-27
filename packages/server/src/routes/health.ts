import { Hono } from "hono";
import type { AppEnv } from "../project-resolver.js";

export function healthRoutes(version: string): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get("/health", (c) => {
    const workspace = c.get("workspace");
    return c.json({
      ok: true,
      version,
      workspace: workspace.root,
      backlogDir: workspace.backlogDir,
      project_id: workspace.project_id,
    });
  });
  return app;
}
