import { loadConfig } from "@backlog/config";
import {
  buildExecutionPlan,
  listTasks,
  listWorkItems,
  type ExecutionPlan,
  type TaskDecision,
} from "@backlog/core";
import type { Task, WorkItem } from "@backlog/schemas";
import { Hono } from "hono";
import type { ServerWorkspace } from "../workspace-context.js";

interface EnrichedDecision {
  task_id: string;
  work_item_id: string;
  task_title: string | null;
  work_item_title: string | null;
  repo: string | null;
  scopes: string[];
  action: TaskDecision["action"];
  score: number;
  reasons: string[];
  assigned_agent_id: string | null;
  candidate_agent_ids: string[];
}

interface ExecutionWave {
  wave: number;
  decisions: EnrichedDecision[];
}

interface OrchestratePlanResponse {
  generated_at: string;
  workspace: string;
  max_agents: number;
  runnable_count: number;
  waves: ExecutionWave[];
  waiting: EnrichedDecision[];
  blocked: EnrichedDecision[];
  skipped: EnrichedDecision[];
}

function enrich(
  decision: TaskDecision,
  tasksById: Map<string, Task>,
  workItemsById: Map<string, WorkItem>,
): EnrichedDecision {
  const task = tasksById.get(decision.taskId) ?? null;
  const workItem = workItemsById.get(decision.workItemId) ?? null;
  return {
    task_id: decision.taskId,
    work_item_id: decision.workItemId,
    task_title: task?.title ?? null,
    work_item_title: workItem?.title ?? null,
    repo: task?.repo ?? null,
    scopes: task?.scopes ?? [],
    action: decision.action,
    score: decision.score,
    reasons: decision.reasons,
    assigned_agent_id: decision.assignedAgentId ?? null,
    candidate_agent_ids: decision.candidateAgentIds ?? [],
  };
}

function pathPrefix(scope: string): string {
  return scope.replace(/[*?[].*$/, "").replace(/\/+$/, "");
}

function decisionsOverlap(left: EnrichedDecision, right: EnrichedDecision): boolean {
  if (left.repo !== right.repo) return false;
  if (left.repo === null) return false;
  for (const a of left.scopes) {
    const aPrefix = pathPrefix(a);
    for (const b of right.scopes) {
      const bPrefix = pathPrefix(b);
      if (aPrefix === bPrefix) return true;
      if (bPrefix.startsWith(aPrefix + "/") || aPrefix.startsWith(bPrefix + "/")) return true;
    }
  }
  return false;
}

function bucketIntoWaves(decisions: EnrichedDecision[], maxAgents: number): ExecutionWave[] {
  const sorted = [...decisions].sort((a, b) => b.score - a.score);
  const waves: ExecutionWave[] = [];
  for (const decision of sorted) {
    let placed = false;
    for (const wave of waves) {
      if (wave.decisions.length >= maxAgents) continue;
      if (wave.decisions.some((other) => decisionsOverlap(other, decision))) continue;
      if (decision.assigned_agent_id) {
        const agentTaken = wave.decisions.some(
          (other) => other.assigned_agent_id === decision.assigned_agent_id,
        );
        if (agentTaken) continue;
      }
      wave.decisions.push(decision);
      placed = true;
      break;
    }
    if (!placed) {
      waves.push({ wave: waves.length + 1, decisions: [decision] });
    }
  }
  return waves;
}

function buildResponse(workspace: ServerWorkspace, plan: ExecutionPlan): OrchestratePlanResponse {
  const tasksById = new Map(listTasks(workspace.backlogDir).map((t) => [t.id, t]));
  const workItemsById = new Map(listWorkItems(workspace.backlogDir).map((w) => [w.id, w]));

  const enrichedRunnable = plan.runnable.map((d) => enrich(d, tasksById, workItemsById));
  const enrichedWaiting = plan.waiting.map((d) => enrich(d, tasksById, workItemsById));
  const enrichedBlocked = plan.blocked.map((d) => enrich(d, tasksById, workItemsById));
  const enrichedSkipped = plan.skipped.map((d) => enrich(d, tasksById, workItemsById));

  const allCandidates = [...enrichedRunnable, ...enrichedWaiting];
  const waves = bucketIntoWaves(allCandidates, Math.max(1, plan.maxAgents));

  return {
    generated_at: plan.generatedAt,
    workspace: workspace.root,
    max_agents: plan.maxAgents,
    runnable_count: enrichedRunnable.length,
    waves,
    waiting: enrichedWaiting,
    blocked: enrichedBlocked,
    skipped: enrichedSkipped,
  };
}

export function orchestrateRoutes(workspace: ServerWorkspace): Hono {
  const app = new Hono();

  app.get("/orchestrate", (c) => {
    try {
      const config = loadConfig(workspace.backlogDir);
      const workItem = c.req.query("work_item");
      const task = c.req.query("task");
      const opts: { workItemId?: string; taskId?: string } = {};
      if (workItem) opts.workItemId = workItem;
      if (task) opts.taskId = task;
      const plan = buildExecutionPlan(workspace.backlogDir, config, opts);
      return c.json(buildResponse(workspace, plan));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "orchestrate_failed", detail: message }, 500);
    }
  });

  return app;
}
