import {
  deleteAccountSecret,
  deleteProjectSecret,
  describeSecretScope,
  hasSecret,
  listAccountSecretKeys,
  listSecretKeys,
  setAccountSecret,
} from "@backlog/config";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../project-resolver.js";

// Secrets endpoint — exposes API-key presence to the UI without ever
// returning values. API keys set from the UI are account-scoped
// (~/.backlog/secrets.json), matching `backlog secrets set`, so they
// work across normal projects and repo-only transient boards. Project
// secrets remain supported as overrides through the lookup chain.

const allowedKeys = z.enum(["ANTHROPIC_API_KEY", "OPENAI_API_KEY"]);

export function secretsRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/secrets", (c) => {
    const project = c.get("project");
    const keys = [...new Set([
      ...listAccountSecretKeys(),
      ...listSecretKeys(project.backlogDir),
    ])].sort();
    return c.json({
      keys: keys.map((key) => ({
        key,
        set: hasSecret(project.backlogDir, key),
        scope: describeSecretScope(project.backlogDir, key),
      })),
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
    setAccountSecret(keyParsed.data, parsed.data.value);
    return c.json({ ok: true, key: keyParsed.data, set: true });
  });

  app.delete("/secrets/:key", (c) => {
    const project = c.get("project");
    const keyParam = c.req.param("key");
    const keyParsed = allowedKeys.safeParse(keyParam);
    if (!keyParsed.success) return c.json({ error: "unknown_key" }, 400);
    deleteProjectSecret(project.backlogDir, keyParsed.data);
    deleteAccountSecret(keyParsed.data);
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
