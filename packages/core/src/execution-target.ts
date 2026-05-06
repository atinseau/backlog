import type { Run, SubTask, Task } from "@backlog/schemas";

export type ExecutionTargetType = "task" | "subtask";

export type ExecutionTarget = SubTask & {
  target_type?: ExecutionTargetType;
};

export function subTaskExecutionTarget(task: SubTask): ExecutionTarget {
  return { ...task, target_type: "subtask" };
}

export function taskExecutionTarget(workItem: Task, repo: string): ExecutionTarget {
  return {
    id: workItem.id,
    task_id: workItem.id,
    title: workItem.title,
    repo,
    status: "queued",
    priority_score: 50,
    risk: workItem.planning.risk,
    scopes: [],
    claim_mode: "exclusive",
    depends_on: [],
    blockers: [],
    execution: {
      ...(workItem.planning.preferred_lane ? { lane: workItem.planning.preferred_lane } : {}),
      preferred_agents: workItem.execution_defaults.preferred_agents,
      required_capabilities: [],
      manual_approval_required: workItem.execution_defaults.manual_approval_required,
    },
    completion: {
      done_when: workItem.acceptance_criteria,
    },
    planner: {
      origin: "manual",
      locked: false,
    },
    created_at: workItem.created_at,
    updated_at: workItem.updated_at,
    target_type: "task",
  };
}

export function runTargetType(run: Pick<Run, "target_type" | "subtask_id">): ExecutionTargetType {
  return run.target_type ?? (run.subtask_id ? "subtask" : "task");
}

export function runTargetId(run: Pick<Run, "target_id" | "subtask_id" | "task_id">): string {
  return run.target_id ?? run.subtask_id ?? run.task_id;
}

export function runSubTaskId(run: Pick<Run, "target_type" | "target_id" | "subtask_id">): string | null {
  if (runTargetType(run) !== "subtask") return null;
  return run.target_id ?? run.subtask_id ?? null;
}
