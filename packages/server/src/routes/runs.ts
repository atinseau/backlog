import { loadConfig } from "@backlog/config";
import {
  approveRun,
  buildExecutionPlan,
  cancelRun,
  discardRun,
  getRunEvents,
  getRunHandoffPath,
  listActiveRuns,
  listAgents,
  listAllRuns,
  listArchivedRuns,
  listSubTasks,
  listTasks,
  loadRun,
  runSubTaskId,
  startRunsForPlan,
} from "@backlog/core";
import { listArchivedClaims, loadActiveClaimIfPresent } from "@backlog/claims";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../project-resolver.js";

const startBodySchema = z.object({
  subtask_id: z.string().min(1).optional(),
  task_id: z.string().min(1).optional(),
  max_start: z.number().int().positive().max(99).optional(),
  agent_id: z.string().min(1).optional(),
  reasoning_effort: z.enum(["minimal", "low", "medium", "high", "xhigh", "max"]).optional(),
  approve: z.boolean().optional(),
  allow_dirty_direct: z.boolean().optional(),
});

const approveBodySchema = z.object({
  summary: z.string().optional(),
  merge_strategy: z.enum(["none", "fast_forward", "merge_commit"]).optional(),
}).strict().optional();

function runSortTime(run: ReturnType<typeof listAllRuns>[number]): number {
  const raw = run.finished_at ?? run.started_at;
  const time = raw ? Date.parse(raw) : 0;
  return Number.isFinite(time) ? time : 0;
}

function parseRunEvent(line: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(line) as unknown;
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
  } catch {
    // Fall through to a displayable plain event.
  }
  return { message: line };
}

function isWholeRepoPath(scope: string): boolean {
  const normalized = scope.trim();
  return normalized === "" || normalized === "." || normalized === "/" || normalized === "*" || normalized === "**";
}

export function runsRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/runs", (c) => {
    const project = c.get("project");
    const scope = c.req.query("scope") ?? "active";
    const activeIds = new Set(listActiveRuns(project.backlogDir).map((run) => run.id));
    const sourceRuns =
      scope === "all"
        ? listAllRuns(project.backlogDir)
        : scope === "archived"
          ? listArchivedRuns(project.backlogDir)
          : listActiveRuns(project.backlogDir);
    const tasksById = new Map(listTasks(project.backlogDir).map((task) => [task.id, task]));
    const subTasksById = new Map(listSubTasks(project.backlogDir).map((task) => [task.id, task]));
    const agentsById = new Map(listAgents(project.backlogDir).map((agent) => [agent.id, agent]));
    const archivedClaimsById = new Map(listArchivedClaims(project.backlogDir).map((claim) => [claim.id, claim]));
    const claimForId = (id: string) =>
      loadActiveClaimIfPresent(project.backlogDir, id) ?? archivedClaimsById.get(id) ?? null;

    const runs = sourceRuns
      .map((run) => {
        const active = activeIds.has(run.id);
        const task = tasksById.get(run.task_id) ?? null;
        const subtaskId = runSubTaskId(run);
        const subtask = subtaskId ? subTasksById.get(subtaskId) ?? null : null;
        const agent = agentsById.get(run.agent_id) ?? null;
        const claims = run.claim_ids
          .map(claimForId)
          .filter((claim): claim is NonNullable<ReturnType<typeof claimForId>> => claim !== null);
        const protectedPaths = [...new Set(claims.flatMap((claim) => claim.paths))];
        const plannedPaths = subtask?.scopes ?? [];
        return {
          ...run,
          active,
          task: task
            ? {
                id: task.id,
                title: task.title,
                status: task.status,
                priority: task.priority,
                labels: task.labels,
                repo_targets: task.repo_targets,
              }
            : null,
          subtask: subtask
            ? {
                id: subtask.id,
                title: subtask.title,
                status: subtask.status,
                scopes: subtask.scopes,
                claim_mode: subtask.claim_mode,
                risk: subtask.risk,
                priority_score: subtask.priority_score,
                preferred_agents: subtask.execution.preferred_agents,
                manual_approval_required: subtask.execution.manual_approval_required,
              }
            : null,
          owner: agent
            ? {
                id: agent.id,
                display_name: agent.display_name ?? null,
                provider: agent.provider,
                model: agent.model ?? null,
                profile: agent.profile ?? null,
              }
            : {
                id: run.agent_id,
                display_name: null,
                provider: run.provider,
                model: null,
                profile: null,
              },
          claims,
          protected_paths: protectedPaths,
          planned_paths: plannedPaths,
          protects_repository:
            protectedPaths.some(isWholeRepoPath) ||
            (protectedPaths.length === 0 && plannedPaths.some(isWholeRepoPath)),
          handoff_path: getRunHandoffPath(project.backlogDir, run.id),
          events: getRunEvents(project.backlogDir, run.id).map(parseRunEvent),
        };
      })
      .sort((a, b) => {
        if (a.active !== b.active) return a.active ? -1 : 1;
        return runSortTime(b) - runSortTime(a);
      });
    return c.json({
      count: runs.length,
      active_count: runs.filter((run) => run.active).length,
      archived_count: runs.filter((run) => !run.active).length,
      runs,
    });
  });

  app.post("/runs", async (c) => {
    const project = c.get("project");
    const raw = await c.req.json().catch(() => null);
    const parsed = startBodySchema.safeParse(raw ?? {});
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);
    }
    const body = parsed.data;

    try {
      const baseConfig = loadConfig(project.backlogDir);
      let config = baseConfig;
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
      const taskRows = listTasks(project.backlogDir);
      const subtaskRows = listSubTasks(project.backlogDir);
      const parentTask = body.task_id
        ? taskRows.find((task) => task.id === body.task_id) ?? null
        : body.subtask_id
          ? taskRows.find((task) => task.id === subtaskRows.find((subtask) => subtask.id === body.subtask_id)?.task_id) ?? null
          : null;
      const taskMaxSubagents = parentTask?.execution_defaults?.max_subagents;
      const effectiveMaxStart = body.max_start ?? taskMaxSubagents ?? config.max_agents;
      if (taskMaxSubagents !== undefined) {
        config = { ...baseConfig, max_agents: taskMaxSubagents };
      }
      const plan = buildExecutionPlan(project.backlogDir, config, {
        ...planOpts,
        ...(taskMaxSubagents !== undefined ? { maxAgentsOverride: taskMaxSubagents, allowAgentOversubscribe: true } : {}),
      });

      const launcherInput: Parameters<typeof startRunsForPlan>[0] = {
        backlogDir: project.backlogDir,
        config,
        plan,
        maxStart: effectiveMaxStart,
      };
      if (body.agent_id) launcherInput.forcedAgentId = body.agent_id;
      if (body.reasoning_effort) launcherInput.reasoningEffort = body.reasoning_effort;
      if (body.allow_dirty_direct) launcherInput.allowDirtyDirect = true;
      if (taskMaxSubagents !== undefined) launcherInput.allowAgentOversubscribe = true;
      const result = await startRunsForPlan(launcherInput);

      return c.json(
        {
          started: result.started,
          skipped: result.skipped,
          waiting: plan.waiting.map((d) => ({ target_type: d.targetType, target_id: d.taskId, subtask_id: d.targetType === "subtask" ? d.taskId : undefined, reasons: d.reasons })),
          blocked: plan.blocked.map((d) => ({ target_type: d.targetType, target_id: d.taskId, subtask_id: d.targetType === "subtask" ? d.taskId : undefined, reasons: d.reasons })),
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
  app.post("/runs/:id/approve", async (c) => {
    const project = c.get("project");
    const runId = c.req.param("id");
    const run = loadRun(project.backlogDir, runId);
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
      const approveOptions: Parameters<typeof approveRun>[3] = {};
      if (parsed.data?.merge_strategy) {
        approveOptions.mergeStrategy = parsed.data.merge_strategy;
      }
      await approveRun(project.backlogDir, runId, parsed.data?.summary, approveOptions);
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
    const project = c.get("project");
    const runId = c.req.param("id");
    const run = loadRun(project.backlogDir, runId);
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
      await cancelRun(project.backlogDir, runId, parsed.data?.summary);
      return c.json({ ok: true, run_id: runId });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "cancel_failed", detail: message }, 500);
    }
  });

  const discardBodySchema = z.object({ summary: z.string().optional() }).strict().optional();
  app.post("/runs/:id/discard", async (c) => {
    const project = c.get("project");
    const runId = c.req.param("id");
    const run = loadRun(project.backlogDir, runId);
    if (!run) {
      return c.json({ error: "unknown_run", detail: `No run named '${runId}'.` }, 404);
    }
    if (run.status !== "awaiting_review") {
      return c.json(
        { error: "wrong_status", detail: `Run is '${run.status}', not 'awaiting_review' — nothing to discard.` },
        409,
      );
    }
    const raw = await c.req.json().catch(() => undefined);
    const parsed = discardBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);
    }
    try {
      await discardRun(project.backlogDir, runId, parsed.data?.summary);
      return c.json({ ok: true, run_id: runId });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "discard_failed", detail: message }, 500);
    }
  });

  return app;
}
