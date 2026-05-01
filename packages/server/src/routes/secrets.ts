import { hasSecret, listSecretKeys, setSecret, deleteSecret } from "@backlog/config";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../project-resolver.js";

// Secrets endpoint — exposes the project's encrypted secrets store
// (secrets.json) to the UI so the user can configure API keys without
// touching the CLI. Only key NAMES + an "is set" flag are returned;
// values stay server-side. Mutations require write access to the
// project dir which is already implicit from being able to reach
// this endpoint.

const allowedKeys = z.enum(["ANTHROPIC_API_KEY", "OPENAI_API_KEY"]);

export function secretsRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/secrets", (c) => {
    const project = c.get("project");
    const keys = listSecretKeys(project.backlogDir);
    return c.json({
      keys: keys.map((key) => ({ key, set: true })),
    });
  });

  app.put("/secrets/:key", async (c) => {
    const project = c.get("project");
    const keyParam = c.req.param("key");
    const keyParsed = allowedKeys.safeParse(keyParam);
    if (!keyParsed.success) return c.json({ error: "unknown_key" }, 400);
    const body = await c.req.json().catch(() => null);
    const parsed = z.object({ value: z.string().min(1) }).safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);
    }
    setSecret(project.backlogDir, keyParsed.data, parsed.data.value);
    return c.json({ ok: true, key: keyParsed.data, set: true });
  });

  app.delete("/secrets/:key", (c) => {
    const project = c.get("project");
    const keyParam = c.req.param("key");
    const keyParsed = allowedKeys.safeParse(keyParam);
    if (!keyParsed.success) return c.json({ error: "unknown_key" }, 400);
    deleteSecret(project.backlogDir, keyParsed.data);
    return c.json({ ok: true, key: keyParsed.data, set: false });
  });

  app.get("/secrets/:key/exists", (c) => {
    const project = c.get("project");
    const keyParam = c.req.param("key");
    const keyParsed = allowedKeys.safeParse(keyParam);
    if (!keyParsed.success) return c.json({ error: "unknown_key" }, 400);
    return c.json({ set: hasSecret(project.backlogDir, keyParsed.data) });
  });

  return app;
}
