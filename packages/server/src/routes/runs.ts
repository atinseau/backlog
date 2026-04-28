import { loadConfig } from "@backlog/config";
import {
  approveRun,
  buildExecutionPlan,
  listActiveRuns,
  loadRun,
  startRunsForPlan,
} from "@backlog/core";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../project-resolver.js";

const startBodySchema = z.object({
  subtask_id: z.string().min(1).optional(),
  task_id: z.string().min(1).optional(),
  max_start: z.number().int().positive().max(50).optional(),
  agent_id: z.string().min(1).optional(),
  approve: z.boolean().optional(),
});

export function runsRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/runs", (c) => {
    const workspace = c.get("workspace");
    const runs = listActiveRuns(workspace.backlogDir);
    return c.json({ count: runs.length, runs });
  });

  app.post("/runs", async (c) => {
    const workspace = c.get("workspace");
    const raw = await c.req.json().catch(() => null);
    const parsed = startBodySchema.safeParse(raw ?? {});
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);
    }
    const body = parsed.data;

    try {
      const config = loadConfig(workspace.backlogDir);
      if (config.autonomy_mode === "observe") {
        return c.json(
          { error: "autonomy_mode_observe", detail: "Runs are disabled in observe mode." },
          403,
        );
      }
      if (config.autonomy_mode === "assist" && !body.approve) {
        return c.json(
          {
            error: "approval_required",
            detail: "Set approve=true to launch runs in assist mode.",
            autonomy_mode: config.autonomy_mode,
          },
          403,
        );
      }

      const planOpts: { workItemId?: string; taskId?: string } = {};
      if (body.task_id) planOpts.workItemId = body.task_id;
      if (body.subtask_id) planOpts.taskId = body.subtask_id;
      const plan = buildExecutionPlan(workspace.backlogDir, config, planOpts);

      const launcherInput: Parameters<typeof startRunsForPlan>[0] = {
        backlogDir: workspace.backlogDir,
        config,
        plan,
        maxStart: body.max_start ?? 1,
      };
      if (body.agent_id) launcherInput.forcedAgentId = body.agent_id;
      const result = await startRunsForPlan(launcherInput);

      return c.json(
        {
          started: result.started,
          skipped: result.skipped,
          waiting: plan.waiting.map((d) => ({ subtask_id: d.taskId, reasons: d.reasons })),
          blocked: plan.blocked.map((d) => ({ subtask_id: d.taskId, reasons: d.reasons })),
        },
        result.started.length > 0 ? 201 : 202,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "run_failed", detail: message }, 500);
    }
  });

  // Approve a run sitting in awaiting_review — the chat-board's
  // one-click "✓ Approuver" button calls this. Mirrors the
  // `backlog runs approve` CLI command. Without this endpoint the
  // user has to drop to a terminal to clear EN REVUE cards, which
  // is the difference between "looks alive" and "I have to babysit".
  const approveBodySchema = z.object({ summary: z.string().optional() }).strict().optional();
  app.post("/runs/:id/approve", async (c) => {
    const workspace = c.get("workspace");
    const runId = c.req.param("id");
    const run = loadRun(workspace.backlogDir, runId);
    if (!run) {
      return c.json({ error: "unknown_run", detail: `No run named '${runId}'.` }, 404);
    }
    if (run.status !== "awaiting_review") {
      return c.json(
        {
          error: "wrong_status",
          detail: `Run is '${run.status}', not 'awaiting_review' — nothing to approve.`,
        },
        409,
      );
    }
    const raw = await c.req.json().catch(() => undefined);
    const parsed = approveBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);
    }
    try {
      await approveRun(workspace.backlogDir, runId, parsed.data?.summary);
      return c.json({ ok: true, run_id: runId });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "approve_failed", detail: message }, 500);
    }
  });

  return app;
}
