import { getSecret, loadConfig } from "@backlog/config";
import {
  applySplitProposal,
  archiveTask,
  createTask,
  listSubTasks,
  listTasks,
  listAllRuns,
  removeTask,
  reorderTask,
  resolveSplitRepos,
  setTaskEstimate,
  splitTask,
  unarchiveTask,
  updateTask,
  updateTaskStatus,
} from "@backlog/core";
import { Hono } from "hono";
import { z } from "zod";
import { AiSplitterUnavailableError, fallbackTitle, suggestSplit, suggestTitle } from "../lib/ai-splitter.js";
import type { AppEnv } from "../project-resolver.js";

const moveBodySchema = z.object({
  to: z.enum([
    "backlog",
    "ready",
    "in_progress",
    "review",
    "test",
    "released",
    "done",
    "blocked",
  ]),
});

const createBodySchema = z.object({
  // Title is now optional client-side: the dialog dropped its title
  // input and lets the description carry the intent. We synthesise
  // a title via the AI title-suggester before persisting (with a
  // first-sentence fallback when the AI provider is unavailable).
  // A non-empty title is still respected when the caller wants to
  // pin one explicitly (CLI / API).
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  priority: z.enum(["P0", "P1", "P2", "P3"]).optional(),
  repo_targets: z.array(z.string().min(1)).optional(),
  labels: z.array(z.string().min(1)).optional(),
  acceptance_criteria: z.array(z.string().min(1)).optional(),
  estimated_duration_seconds: z.number().int().positive().optional(),
  manual_approval_required: z.boolean().optional(),
  auto_commit: z.boolean().optional(),
  push_when_done: z.boolean().optional(),
  create_pr: z.boolean().optional(),
  merge_pr: z.boolean().optional(),
  worktree_mode: z.enum(["isolated_worktree", "direct"]).optional(),
  preferred_agents: z.array(z.string().min(1)).optional(),
});

const reorderBodySchema = z.object({
  before_id: z.string().min(1).optional(),
  after_id: z.string().min(1).optional(),
});

const estimateBodySchema = z
  .object({
    seconds: z.number().int().positive().nullable(),
  })
  .strict();

const splitBodySchema = z.object({
  repos: z.array(z.string().min(1)).optional(),
  mode: z.enum(["parallel", "serial"]).default("parallel"),
  scope_by_repo: z.record(z.string(), z.array(z.string())).optional(),
  risk: z.enum(["low", "medium", "high"]).optional(),
  force: z.boolean().optional(),
});

const applySplitBodySchema = z.object({
  tasks: z
    .array(
      z.object({
        title: z.string().min(1),
        repo: z.string().min(1),
        scopes: z.array(z.string().min(1)).min(1),
        risk: z.enum(["low", "medium", "high"]),
        depends_on_indices: z.array(z.number().int().min(0)).default([]),
      }),
    )
    .min(1)
    .max(12),
  force: z.boolean().optional(),
});

export function workItemsRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/tasks/:id", (c) => {
    const workspace = c.get("workspace");
    const id = c.req.param("id");
    const task = listTasks(workspace.backlogDir).find((item) => item.id === id);
    if (!task) {
      return c.json({ error: "unknown_task", id }, 404);
    }
    const runsBySubtask = new Map<string, ReturnType<typeof listAllRuns>[number]>();
    for (const run of listAllRuns(workspace.backlogDir)) {
      const previous = runsBySubtask.get(run.subtask_id);
      const currentTime = new Date(run.finished_at ?? run.started_at ?? 0).getTime();
      const previousTime = previous ? new Date(previous.finished_at ?? previous.started_at ?? 0).getTime() : -1;
      if (!previous || currentTime >= previousTime) {
        runsBySubtask.set(run.subtask_id, run);
      }
    }
    const subtasks = listSubTasks(workspace.backlogDir)
      .filter((sub) => sub.task_id === id)
      .map((sub) => {
        const run = runsBySubtask.get(sub.id);
        return {
          ...sub,
          latest_run: run
            ? {
                id: run.id,
                status: run.status,
                agent_id: run.agent_id,
                started_at: run.started_at,
                finished_at: run.finished_at,
                execution_mode: run.execution_mode,
                result: run.result,
              }
            : null,
        };
      });
    return c.json({ task, subtasks });
  });

  app.post("/tasks", async (c) => {
    const workspace = c.get("workspace");
    const raw = await c.req.json().catch(() => null);
    const parsed = createBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);
    }
    try {
      // Resolve the title. If the caller provided one, keep it
      // verbatim; otherwise synthesize one from the description via
      // the AI title-suggester. Falls back to fallbackTitle() (first
      // sentence, capitalised) when the AI provider is unavailable
      // so task creation never blocks on credentials.
      let resolvedTitle = parsed.data.title?.trim();
      const description = parsed.data.description?.trim() ?? "";
      let titleSource: "user" | "ai" | "fallback" = "user";
      let titleModel: string | null = null;
      if (!resolvedTitle) {
        if (!description) {
          return c.json(
            { error: "missing_title_and_description", detail: "Provide either a title or a description so we can name the task." },
            400,
          );
        }
        try {
          const apiKey = getSecret(workspace.backlogDir, "ANTHROPIC_API_KEY") ?? undefined;
          const suggestion = await suggestTitle(description, apiKey ? { apiKey } : {});
          resolvedTitle = suggestion.title;
          titleSource = "ai";
          titleModel = suggestion.model;
        } catch (suggestErr) {
          // AI unavailable / wire failure / quota — degrade
          // gracefully. The user still gets a task, just with a
          // less polished title they can rename later.
          resolvedTitle = fallbackTitle(description);
          titleSource = "fallback";
          // Surface the hint in the response so the UI can show a
          // tiny "AI title unavailable, used first-sentence fallback"
          // note if it wants — non-blocking.
          // (We deliberately don't 500 here; the create still works.)
          void suggestErr;
        }
      }
      const input: Parameters<typeof createTask>[1] = {
        title: resolvedTitle!,
      };
      if (parsed.data.description !== undefined) input.description = parsed.data.description;
      if (parsed.data.priority !== undefined) input.priority = parsed.data.priority;
      if (parsed.data.repo_targets !== undefined) input.repoTargets = parsed.data.repo_targets;
      if (parsed.data.labels !== undefined) input.labels = parsed.data.labels;
      if (parsed.data.acceptance_criteria !== undefined) input.acceptanceCriteria = parsed.data.acceptance_criteria;
      if (parsed.data.manual_approval_required !== undefined) input.manualApprovalRequired = parsed.data.manual_approval_required;
      if (parsed.data.auto_commit !== undefined) input.autoCommit = parsed.data.auto_commit;
      if (parsed.data.push_when_done !== undefined) input.pushWhenDone = parsed.data.push_when_done;
      if (parsed.data.create_pr !== undefined) input.createPr = parsed.data.create_pr;
      if (parsed.data.merge_pr !== undefined) input.mergePr = parsed.data.merge_pr;
      if (parsed.data.worktree_mode !== undefined) input.worktreeMode = parsed.data.worktree_mode;
      if (parsed.data.preferred_agents !== undefined) input.preferredAgents = parsed.data.preferred_agents;
      let workItem = createTask(workspace.backlogDir, input);
      if (parsed.data.estimated_duration_seconds) {
        workItem = setTaskEstimate(workspace.backlogDir, workItem.id, parsed.data.estimated_duration_seconds);
      }
      // Echo back how the title was resolved so the UI can surface a
      // small hint ("Title generated by claude-haiku-4-5"). Optional
      // fields — older clients ignore them.
      const meta: { title_source: typeof titleSource; title_model?: string } = { title_source: titleSource };
      if (titleModel) meta.title_model = titleModel;
      return c.json({ task: workItem, ...meta }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "create_failed", detail: message }, 400);
    }
  });

  app.post("/tasks/:id/move", async (c) => {
    const workspace = c.get("workspace");
    const id = c.req.param("id");
    const raw = await c.req.json().catch(() => null);
    const parsed = moveBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);
    }
    try {
      const updated = updateTaskStatus(workspace.backlogDir, id, parsed.data.to);
      return c.json({ task: updated });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "update_failed", detail: message }, 404);
    }
  });

  app.post("/tasks/:id/split", async (c) => {
    const workspace = c.get("workspace");
    const id = c.req.param("id");
    const raw = await c.req.json().catch(() => null);
    const parsed = splitBodySchema.safeParse(raw ?? {});
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);
    }
    try {
      const config = loadConfig(workspace.backlogDir);
      const workItem = listTasks(workspace.backlogDir).find((item) => item.id === id);
      if (!workItem) {
        return c.json({ error: "unknown_work_item", id }, 404);
      }
      const repos = resolveSplitRepos(config, workItem, parsed.data.repos);
      const input: Parameters<typeof splitTask>[1] = {
        workItemId: id,
        repos,
        mode: parsed.data.mode,
      };
      if (parsed.data.scope_by_repo !== undefined) input.scopeByRepo = parsed.data.scope_by_repo;
      if (parsed.data.risk !== undefined) input.risk = parsed.data.risk;
      if (parsed.data.force !== undefined) input.force = parsed.data.force;
      const result = splitTask(workspace.backlogDir, input);
      return c.json({
        task: result.workItem,
        created_tasks: result.createdTasks,
        mode: result.mode,
      }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message.startsWith("Unknown") || message.includes("Unknown ") ? 404 : 400;
      return c.json({ error: "split_failed", detail: message }, status);
    }
  });

  app.post("/tasks/:id/suggest-split", async (c) => {
    const workspace = c.get("workspace");
    const id = c.req.param("id");
    try {
      const config = loadConfig(workspace.backlogDir);
      const workItem = listTasks(workspace.backlogDir).find((item) => item.id === id);
      if (!workItem) {
        return c.json({ error: "unknown_work_item", id }, 404);
      }
      const repos = config.repos.map((repo) => repo.id);
      if (repos.length === 0) {
        return c.json(
          { error: "no_repos", detail: "Configure at least one repo in the workspace before requesting a split." },
          400,
        );
      }
      const proposal = await suggestSplit(workItem, repos, { provider: config.ai_provider });
      return c.json({
        task_id: id,
        model: proposal.model,
        rationale: proposal.rationale,
        tasks: proposal.tasks.map((task) => ({
          title: task.title,
          repo: task.repo,
          scopes: task.scopes,
          risk: task.risk,
          depends_on_indices: task.depends_on_indices,
        })),
      });
    } catch (error) {
      if (error instanceof AiSplitterUnavailableError) {
        return c.json({ error: "ai_unavailable", detail: error.message }, 503);
      }
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "suggest_failed", detail: message }, 500);
    }
  });

  app.post("/tasks/:id/apply-split", async (c) => {
    const workspace = c.get("workspace");
    const id = c.req.param("id");
    const raw = await c.req.json().catch(() => null);
    const parsed = applySplitBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);
    }
    try {
      const result = applySplitProposal(workspace.backlogDir, {
        workItemId: id,
        tasks: parsed.data.tasks.map((task) => ({
          title: task.title,
          repo: task.repo,
          scopes: task.scopes,
          risk: task.risk,
          dependsOnIndices: task.depends_on_indices,
        })),
        ...(parsed.data.force !== undefined ? { force: parsed.data.force } : {}),
      });
      return c.json(
        {
          task: result.workItem,
          created_tasks: result.createdTasks,
          mode: result.mode,
        },
        201,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message.startsWith("Unknown") ? 404 : 400;
      return c.json({ error: "apply_failed", detail: message }, status);
    }
  });

  app.post("/tasks/:id/reorder", async (c) => {
    const workspace = c.get("workspace");
    const id = c.req.param("id");
    const raw = await c.req.json().catch(() => ({}));
    const parsed = reorderBodySchema.safeParse(raw ?? {});
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);
    }
    try {
      const input: Parameters<typeof reorderTask>[1] = { workItemId: id };
      if (parsed.data.before_id !== undefined) input.beforeId = parsed.data.before_id;
      if (parsed.data.after_id !== undefined) input.afterId = parsed.data.after_id;
      const workItem = reorderTask(workspace.backlogDir, input);
      return c.json({ task: workItem });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "reorder_failed", detail: message }, 404);
    }
  });

  app.patch("/tasks/:id/estimate", async (c) => {
    const workspace = c.get("workspace");
    const id = c.req.param("id");
    const raw = await c.req.json().catch(() => null);
    const parsed = estimateBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);
    }
    try {
      const workItem = setTaskEstimate(workspace.backlogDir, id, parsed.data.seconds);
      return c.json({ task: workItem });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "estimate_failed", detail: message }, 404);
    }
  });

  // PATCH a small set of task fields (priority, title, description,
  // labels, repo_targets, execution defaults). Used by focused UI
  // actions such as priority changes, assignee changes, and switching
  // a blocked direct-mode task to an isolated worktree. Validation
  // mirrors the create body — only the fields listed here are touched,
  // others are left as-is.
  const patchBodySchema = z.object({
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    priority: z.enum(["P0", "P1", "P2", "P3"]).optional(),
    labels: z.array(z.string().min(1)).optional(),
    repo_targets: z.array(z.string().min(1)).optional(),
    // Assignee for new sub-tasks generated from this task. The kanban
    // card menu's Assign ▸ picker writes here. Empty array means
    // "let the scheduler pick" (auto). Existing sub-tasks aren't
    // retroactively reassigned — open them individually for that.
    preferred_agents: z.array(z.string().min(1)).optional(),
    worktree_mode: z.enum(["isolated_worktree", "direct"]).optional(),
  });
  app.patch("/tasks/:id", async (c) => {
    const workspace = c.get("workspace");
    const id = c.req.param("id");
    const raw = await c.req.json().catch(() => null);
    const parsed = patchBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.format() }, 400);
    }
    try {
      const input: Parameters<typeof updateTask>[2] = {};
      if (parsed.data.title !== undefined) input.title = parsed.data.title;
      if (parsed.data.description !== undefined) input.description = parsed.data.description;
      if (parsed.data.priority !== undefined) input.priority = parsed.data.priority;
      if (parsed.data.labels !== undefined) input.labels = parsed.data.labels;
      if (parsed.data.repo_targets !== undefined) input.repoTargets = parsed.data.repo_targets;
      if (parsed.data.preferred_agents !== undefined) input.preferredAgents = parsed.data.preferred_agents;
      if (parsed.data.worktree_mode !== undefined) input.worktreeMode = parsed.data.worktree_mode;
      const task = updateTask(workspace.backlogDir, id, input);
      return c.json({ task });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "patch_failed", detail: message }, 404);
    }
  });

  // Archive: soft-hide. Reversible via /unarchive. Distinct from
  // DELETE — the row stays on disk, the scheduler skips it, and the
  // board hides it from the default view.
  app.post("/tasks/:id/archive", (c) => {
    const workspace = c.get("workspace");
    const id = c.req.param("id");
    try {
      const task = archiveTask(workspace.backlogDir, id);
      return c.json({ task });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "archive_failed", detail: message }, 404);
    }
  });

  app.post("/tasks/:id/unarchive", (c) => {
    const workspace = c.get("workspace");
    const id = c.req.param("id");
    try {
      const task = unarchiveTask(workspace.backlogDir, id);
      return c.json({ task });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "unarchive_failed", detail: message }, 404);
    }
  });

  // Hard delete. Cascade=true also removes the linked subtasks.
  // Returns the removed task so the UI can confirm or undo locally.
  app.delete("/tasks/:id", (c) => {
    const workspace = c.get("workspace");
    const id = c.req.param("id");
    const cascade = c.req.query("cascade") === "true";
    try {
      const task = removeTask(workspace.backlogDir, id, { cascadeTasks: cascade });
      return c.json({ task });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "delete_failed", detail: message }, 404);
    }
  });

  return app;
}
