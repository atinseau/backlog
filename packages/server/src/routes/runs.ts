import { loadConfig } from "@backlog/config";
import {
  approveRun,
  buildExecutionPlan,
  cancelRun,
  createSubTask,
  listActiveRuns,
  listRepos,
  listSubTasks,
  listTasks,
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

      // Auto-shim: if the user clicked Play on a task that has no
      // sub-tasks yet, create one covering the whole work and run it.
      // The "split first" workflow stays available via the ✂ button
      // for genuinely multi-step work; for "create one file" tasks
      // the auto-shim keeps the Play button honest.
      if (body.task_id && !body.subtask_id) {
        const existing = listSubTasks(workspace.backlogDir).filter(
          (s) => s.task_id === body.task_id,
        );
        if (existing.length === 0) {
          const task = listTasks(workspace.backlogDir).find((t) => t.id === body.task_id);
          if (task) {
            const repos = listRepos(workspace.backlogDir);
            // Pick a target repo: first explicit repo_target, else first
            // enabled workspace repo, else the only repo if there is one.
            const repoId =
              task.repo_targets[0] ??
              repos.find((r) => r.enabled)?.id ??
              repos[0]?.id;
            if (repoId) {
              const subInput: Parameters<typeof createSubTask>[1] = {
                workItemId: task.id,
                title: task.title,
                repo: repoId,
                risk: task.planning?.risk ?? "medium",
                plannerOrigin: "manual",
                manualApprovalRequired: task.execution_defaults?.manual_approval_required ?? false,
              };
              // Inherit the task's preferred assignee. Empty list =
              // "auto pick" — the planner ranks all eligible agents.
              const preferred = task.execution_defaults?.preferred_agents ?? [];
              if (preferred.length > 0) subInput.preferredAgents = preferred;
              createSubTask(workspace.backlogDir, subInput);
            }
          }
        }
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

  // Cancel an in-flight or queued run. The sub-task goes back to
  // "planned" so the user can restart it; dependents are NOT
  // cascade-blocked. Used by the topbar Stop button when individual
  // runs (not the global orchestrator) need stopping.
  const cancelBodySchema = z.object({ summary: z.string().optional() }).strict().optional();
  app.post("/runs/:id/cancel", async (c) => {
    const workspace = c.get("workspace");
    const runId = c.req.param("id");
    const run = loadRun(workspace.backlogDir, runId);
    if (!run) {
      return c.json({ error: "unknown_run", detail: `No run named '${runId}'.` }, 404);
    }
    if (run.status === "succeeded" || run.status === "failed" || run.status === "canceled") {
      return c.json(
        { error: "wrong_status", detail: `Run is '${run.status}', already terminal.` },
        409,
      );
    }
    const raw = await c.req.json().catch(() => undefined);
    const parsed = cancelBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);
    }
    try {
      await cancelRun(workspace.backlogDir, runId, parsed.data?.summary);
      return c.json({ ok: true, run_id: runId });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "cancel_failed", detail: message }, 500);
    }
  });

  return app;
}
