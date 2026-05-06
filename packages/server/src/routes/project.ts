import { loadConfig, saveConfig } from "@backlog/config";
import { Hono, type Context } from "hono";
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

const boardBodySchema = z
  .object({
    show_backlog_column: z.boolean().optional(),
  })
  .strict();

export function projectRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  function renderProject(c: Context<AppEnv>) {
    const project = c.get("project");
    const config = loadConfig(project.backlogDir);
    return c.json({
      project: {
        id: project.project_id,
        name: config.project_name,
        mode: config.project_mode,
        default_branch: config.default_branch,
        autonomy_mode: config.autonomy_mode,
        max_agents: config.max_agents,
        claims: config.claims,
        board: config.board,
        review: config.review,
      },
    });
  }

  app.get("/project", renderProject);
  app.get("/workspace", (c) => {
    const project = c.get("project");
    const config = loadConfig(project.backlogDir);
    return c.json({
      workspace: {
        id: project.project_id,
        name: config.project_name,
        mode: config.project_mode,
        default_branch: config.default_branch,
        autonomy_mode: config.autonomy_mode,
        max_agents: config.max_agents,
        claims: config.claims,
        board: config.board,
        review: config.review,
      },
    });
  });

  async function patchAutonomy(c: Context<AppEnv>) {
    const project = c.get("project");
    const raw = await c.req.json().catch(() => null);
    const parsed = autonomyBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);
    }
    const config = loadConfig(project.backlogDir);
    config.autonomy_mode = parsed.data.autonomy_mode;
    saveConfig(project.backlogDir, config);
    return c.json({ autonomy_mode: config.autonomy_mode });
  }

  app.patch("/project/autonomy", patchAutonomy);
  app.patch("/workspace/autonomy", patchAutonomy);

  async function patchClaims(c: Context<AppEnv>) {
    const project = c.get("project");
    const raw = await c.req.json().catch(() => null);
    const parsed = claimsBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);
    }
    const config = loadConfig(project.backlogDir);
    if (parsed.data.ttl_minutes !== undefined) config.claims.ttl_minutes = parsed.data.ttl_minutes;
    if (parsed.data.enforce_on_commit !== undefined) config.claims.enforce_on_commit = parsed.data.enforce_on_commit;
    if (parsed.data.auto_claim_on_commit !== undefined) config.claims.auto_claim_on_commit = parsed.data.auto_claim_on_commit;
    saveConfig(project.backlogDir, config);
    return c.json({ claims: config.claims });
  }

  app.patch("/project/claims", patchClaims);
  app.patch("/workspace/claims", patchClaims);

  async function patchBoard(c: Context<AppEnv>) {
    const project = c.get("project");
    const raw = await c.req.json().catch(() => null);
    const parsed = boardBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);
    }
    const config = loadConfig(project.backlogDir);
    if (parsed.data.show_backlog_column !== undefined) {
      config.board.show_backlog_column = parsed.data.show_backlog_column;
    }
    saveConfig(project.backlogDir, config);
    return c.json({ board: config.board });
  }

  app.patch("/project/board", patchBoard);
  app.patch("/workspace/board", patchBoard);

  async function patchReview(c: Context<AppEnv>) {
    const project = c.get("project");
    const raw = await c.req.json().catch(() => null);
    const parsed = reviewBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);
    }
    const config = loadConfig(project.backlogDir);
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
    saveConfig(project.backlogDir, config);
    return c.json({ review: config.review });
  }

  app.patch("/project/review", patchReview);
  app.patch("/workspace/review", patchReview);

  return app;
}
