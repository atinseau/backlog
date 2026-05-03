import { Hono } from "hono";
import { resolveCliStatus } from "../lib/cli-status.js";
import type { AppEnv } from "../project-resolver.js";

export function healthRoutes(version: string): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get("/health", async (c) => {
    const project = c.get("project");
    const cli = await resolveCliStatus();
    return c.json({
      ok: true,
      version,
      app_version: version,
      server_version: version,
      cli,
      project: project.root,
      backlogDir: project.backlogDir,
      project_id: project.project_id,
    });
  });
  return app;
}
