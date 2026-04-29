import { loadConfig, saveConfig } from "@backlog/config";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../project-resolver.js";

const autonomyBodySchema = z.object({
  autonomy_mode: z.enum(["observe", "assist", "delegate", "autopilot"]),
});

const claimsBodySchema = z
  .object({
    ttl_minutes: z.number().int().positive().optional(),
    enforce_on_commit: z.boolean().optional(),
    auto_claim_on_commit: z.boolean().optional(),
  })
  .strict();

const reviewBodySchema = z
  .object({
    show_review_column: z.boolean().optional(),
    // Empty string clears the auto-reviewer (= manual review only).
    auto_reviewer_agent_id: z.string().nullable().optional(),
  })
  .strict();

export function projectRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/workspace", (c) => {
    const workspace = c.get("workspace");
    const config = loadConfig(workspace.backlogDir);
    return c.json({
      workspace: {
        id: workspace.project_id,
        name: config.project_name,
        mode: config.project_mode,
        default_branch: config.default_branch,
        autonomy_mode: config.autonomy_mode,
        max_agents: config.max_agents,
        claims: config.claims,
        review: config.review,
      },
    });
  });

  app.patch("/workspace/autonomy", async (c) => {
    const workspace = c.get("workspace");
    const raw = await c.req.json().catch(() => null);
    const parsed = autonomyBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);
    }
    const config = loadConfig(workspace.backlogDir);
    config.autonomy_mode = parsed.data.autonomy_mode;
    saveConfig(workspace.backlogDir, config);
    return c.json({ autonomy_mode: config.autonomy_mode });
  });

  app.patch("/workspace/claims", async (c) => {
    const workspace = c.get("workspace");
    const raw = await c.req.json().catch(() => null);
    const parsed = claimsBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);
    }
    const config = loadConfig(workspace.backlogDir);
    if (parsed.data.ttl_minutes !== undefined) config.claims.ttl_minutes = parsed.data.ttl_minutes;
    if (parsed.data.enforce_on_commit !== undefined) config.claims.enforce_on_commit = parsed.data.enforce_on_commit;
    if (parsed.data.auto_claim_on_commit !== undefined) config.claims.auto_claim_on_commit = parsed.data.auto_claim_on_commit;
    saveConfig(workspace.backlogDir, config);
    return c.json({ claims: config.claims });
  });

  app.patch("/workspace/review", async (c) => {
    const workspace = c.get("workspace");
    const raw = await c.req.json().catch(() => null);
    const parsed = reviewBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);
    }
    const config = loadConfig(workspace.backlogDir);
    if (parsed.data.show_review_column !== undefined) {
      config.review.show_review_column = parsed.data.show_review_column;
    }
    if (parsed.data.auto_reviewer_agent_id !== undefined) {
      // null or empty string clears the field; an id sets it.
      const id = parsed.data.auto_reviewer_agent_id;
      if (id === null || id === "") {
        delete config.review.auto_reviewer_agent_id;
      } else {
        config.review.auto_reviewer_agent_id = id;
      }
    }
    saveConfig(workspace.backlogDir, config);
    return c.json({ review: config.review });
  });

  return app;
}
