import { loadConfig } from "@backlog/config";
import {
  buildExecutionPlan,
  listActiveRuns,
  startRunsForPlan,
} from "@backlog/core";
import { Hono } from "hono";
import { z } from "zod";
import type { ServerWorkspace } from "../workspace-context.js";

const startBodySchema = z.object({
  work_item_id: z.string().min(1).optional(),
  task_id: z.string().min(1).optional(),
  max_start: z.number().int().positive().max(50).optional(),
  agent_id: z.string().min(1).optional(),
  approve: z.boolean().optional(),
});

export function runsRoutes(workspace: ServerWorkspace): Hono {
  const app = new Hono();

  app.get("/runs", (c) => {
    const runs = listActiveRuns(workspace.backlogDir);
    return c.json({ count: runs.length, runs });
  });

  app.post("/runs", async (c) => {
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
      if (body.work_item_id) planOpts.workItemId = body.work_item_id;
      if (body.task_id) planOpts.taskId = body.task_id;
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
          waiting: plan.waiting.map((d) => ({ task_id: d.taskId, reasons: d.reasons })),
          blocked: plan.blocked.map((d) => ({ task_id: d.taskId, reasons: d.reasons })),
        },
        result.started.length > 0 ? 201 : 202,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "run_failed", detail: message }, 500);
    }
  });

  return app;
}
