import { loadConfig } from "@backlog/config";
import {
  buildExecutionPlan,
  estimateRunCost,
  listSubTasks,
  listTasks,
  type ExecutionPlan,
  type SubTaskDecision,
} from "@backlog/core";
import type { SubTask, Task } from "@backlog/schemas";
import { Hono } from "hono";
import type { ServerProject } from "../project-context.js";
import type { AppEnv } from "../project-resolver.js";

interface EnrichedDecision {
  subtask_id: string;
  task_id: string;
  subtask_title: string | null;
  task_title: string | null;
  repo: string | null;
  scopes: string[];
  action: SubTaskDecision["action"];
  score: number;
  reasons: string[];
  assigned_agent_id: string | null;
  candidate_agent_ids: string[];
  // Median USD cost across past runs that match this decision's
  // (repo, agent) pair. null when there's not enough history yet.
  // The board UI surfaces this as a pill next to the ▶ button.
  predicted_cost_usd: number | null;
  predicted_cost_sample_size: number | null;
}

interface ExecutionWave {
  wave: number;
  decisions: EnrichedDecision[];
}

interface OrchestratePlanResponse {
  generated_at: string;
  project: string;
  max_agents: number;
  runnable_count: number;
  waves: ExecutionWave[];
  waiting: EnrichedDecision[];
  blocked: EnrichedDecision[];
  skipped: EnrichedDecision[];
}

function enrich(
  decision: SubTaskDecision,
  tasksById: Map<string, SubTask>,
  workItemsById: Map<string, Task>,
  costEstimateFor: (repo: string | null, agentId: string | null) => { cost_usd: number; sample_size: number } | null,
): EnrichedDecision {
  const task = tasksById.get(decision.taskId) ?? null;
  const workItem = workItemsById.get(decision.workItemId) ?? null;
  const repo = task?.repo ?? null;
  const agentId = decision.assignedAgentId ?? null;
  const estimate = costEstimateFor(repo, agentId);
  return {
    subtask_id: decision.taskId,
    task_id: decision.workItemId,
    subtask_title: task?.title ?? null,
    task_title: workItem?.title ?? null,
    repo,
    scopes: task?.scopes ?? [],
    action: decision.action,
    score: decision.score,
    reasons: decision.reasons,
    assigned_agent_id: agentId,
    candidate_agent_ids: decision.candidateAgentIds ?? [],
    predicted_cost_usd: estimate?.cost_usd ?? null,
    predicted_cost_sample_size: estimate?.sample_size ?? null,
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

function buildResponse(project: ServerProject, plan: ExecutionPlan): OrchestratePlanResponse {
  const tasksById = new Map(listSubTasks(project.backlogDir).map((t) => [t.id, t]));
  const workItemsById = new Map(listTasks(project.backlogDir).map((w) => [w.id, w]));

  // Memoize the cost estimate by (repo, agent) — multiple decisions
  // commonly share both, and estimateRunCost walks the run archive
  // each call. Null repo or null agent both fall through to a
  // project-wide median.
  const costCache = new Map<string, { cost_usd: number; sample_size: number } | null>();
  const costEstimateFor = (repo: string | null, agentId: string | null) => {
    const key = `${repo ?? ""}::${agentId ?? ""}`;
    if (costCache.has(key)) return costCache.get(key) ?? null;
    const estimate = estimateRunCost(project.backlogDir, {
      ...(repo ? { repo } : {}),
      ...(agentId ? { agent_id: agentId } : {}),
    });
    costCache.set(key, estimate);
    return estimate;
  };

  const enrichedRunnable = plan.runnable.map((d) => enrich(d, tasksById, workItemsById, costEstimateFor));
  const enrichedWaiting = plan.waiting.map((d) => enrich(d, tasksById, workItemsById, costEstimateFor));
  const enrichedBlocked = plan.blocked.map((d) => enrich(d, tasksById, workItemsById, costEstimateFor));
  const enrichedSkipped = plan.skipped.map((d) => enrich(d, tasksById, workItemsById, costEstimateFor));

  const allCandidates = [...enrichedRunnable, ...enrichedWaiting];
  const waves = bucketIntoWaves(allCandidates, Math.max(1, plan.maxAgents));

  return {
    generated_at: plan.generatedAt,
    project: project.root,
    max_agents: plan.maxAgents,
    runnable_count: enrichedRunnable.length,
    waves,
    waiting: enrichedWaiting,
    blocked: enrichedBlocked,
    skipped: enrichedSkipped,
  };
}

export function orchestrateRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/orchestrate", (c) => {
    const project = c.get("project");
    try {
      const config = loadConfig(project.backlogDir);
      const task = c.req.query("task") ?? c.req.query("work" + "_item");
      const subtask = c.req.query("subtask");
      const opts: { workItemId?: string; taskId?: string } = {};
      if (task) opts.workItemId = task;
      if (subtask) opts.taskId = subtask;
      const plan = buildExecutionPlan(project.backlogDir, config, opts);
    return c.json(buildResponse(project, plan));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "orchestrate_failed", detail: message }, 500);
    }
  });

  return app;
}
