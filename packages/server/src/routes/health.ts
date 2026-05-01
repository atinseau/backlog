import { Hono } from "hono";
import type { AppEnv } from "../project-resolver.js";

export function healthRoutes(version: string): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get("/health", (c) => {
    const project = c.get("project");
    return c.json({
      ok: true,
      version,
      project: project.root,
      backlogDir: project.backlogDir,
      project_id: project.project_id,
    });
  });
  return app;
}
