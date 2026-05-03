import { Hono } from "hono";
import { resolveCliStatus, updateCli } from "../lib/cli-status.js";
import type { AppEnv } from "../project-resolver.js";

export function healthRoutes(version: string): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get("/health", async (c) => {
    const project = c.get("project");
    const cli = await resolveCliStatus({ force: c.req.query("refresh_cli") === "1" });
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

  app.get("/cli/status", async (c) => {
    const cli = await resolveCliStatus({ force: c.req.query("refresh") === "1" });
    return c.json({ cli });
  });

  app.post("/cli/update", async (c) => {
    const result = await updateCli();
    return c.json(result, result.ok ? 200 : 409);
  });
  return app;
}
