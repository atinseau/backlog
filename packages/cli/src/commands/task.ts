import { Command } from "commander";
import { findWorkspace } from "@cockpit-ai/config";
import { blockTask, buildExecutionPlan, createTask, getTask, listTasks, unblockTask, updateTask, updateTaskStatus } from "@cockpit-ai/core";
import { loadConfig } from "@cockpit-ai/config";

function collectValues(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function parseBooleanFlag(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "yes" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "no" || normalized === "0") {
    return false;
  }
  throw new Error(`Expected a boolean value, received: ${value}`);
}

export function registerTaskCommand(program: Command): void {
  const task = program.command("task").description("Manage executable tasks");

  task
    .command("add")
    .description("Create a task for a work item")
    .requiredOption("--work-item <id>", "Parent work item id")
    .requiredOption("--title <title>", "Task title")
    .requiredOption("--repo <repo>", "Target repo id")
    .option("--scope <scope...>", "Task scopes")
    .option("--depends-on <task...>", "Task dependencies")
    .option("--blocker <reason...>", "Initial blockers")
    .option("--risk <risk>", "Risk level", "medium")
    .option("--preferred-agent <id...>", "Preferred agent ids")
    .option("--require-capability <capability...>", "Required agent capabilities")
    .option("--manual-approval", "Require approval before scheduling")
    .action((options: {
      workItem: string;
      title: string;
      repo: string;
      scope?: string[];
      dependsOn?: string[];
      blocker?: string[];
      risk?: "low" | "medium" | "high";
      preferredAgent?: string[];
      requireCapability?: string[];
      manualApproval?: boolean;
    }) => {
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .cockpit workspace found. Run `cockpit init` first.");
      }
      const created = createTask(workspace.cockpitDir, {
        workItemId: options.workItem,
        title: options.title,
        repo: options.repo,
        ...(options.scope ? { scopes: options.scope } : {}),
        ...(options.dependsOn ? { dependsOn: options.dependsOn } : {}),
        ...(options.blocker ? { blockers: options.blocker } : {}),
        ...(options.risk ? { risk: options.risk } : {}),
        ...(options.preferredAgent ? { preferredAgents: options.preferredAgent } : {}),
        ...(options.requireCapability ? { requiredCapabilities: options.requireCapability } : {}),
        ...(options.manualApproval ? { manualApprovalRequired: true } : {}),
      });
      console.log(`Created task ${created.id}`);
    });

  task
    .command("update")
    .description("Update task metadata without editing YAML by hand")
    .argument("<task-id>", "Task id")
    .option("--title <title>", "Task title")
    .option("--repo <repo>", "Target repo id")
    .option("--scope <scope>", "Replace task scopes", collectValues, [])
    .option("--depends-on <task>", "Replace task dependencies", collectValues, [])
    .option("--blocker <reason>", "Replace task blockers", collectValues, [])
    .option("--risk <risk>", "Risk level")
    .option("--priority-score <score>", "Priority score")
    .option("--claim-mode <mode>", "exclusive or shared")
    .option("--done-when <criterion>", "Replace completion criteria", collectValues, [])
    .option("--lane <lane>", "Execution lane")
    .option("--preferred-agent <id>", "Replace preferred agents", collectValues, [])
    .option("--require-capability <capability>", "Replace required agent capabilities", collectValues, [])
    .option("--manual-approval <enabled>", "Whether the task requires manual approval")
    .option("--planner-locked <enabled>", "Whether replanning can overwrite the task")
    .action((taskId: string, options: {
      title?: string;
      repo?: string;
      scope: string[];
      dependsOn: string[];
      blocker: string[];
      risk?: "low" | "medium" | "high";
      priorityScore?: string;
      claimMode?: "exclusive" | "shared";
      doneWhen: string[];
      lane?: string;
      preferredAgent: string[];
      requireCapability: string[];
      manualApproval?: string;
      plannerLocked?: string;
    }) => {
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .cockpit workspace found. Run `cockpit init` first.");
      }

      const updated = updateTask(workspace.cockpitDir, taskId, {
        ...(options.title !== undefined ? { title: options.title } : {}),
        ...(options.repo !== undefined ? { repo: options.repo } : {}),
        ...(options.scope.length > 0 ? { scopes: options.scope } : {}),
        ...(options.dependsOn.length > 0 ? { dependsOn: options.dependsOn } : {}),
        ...(options.blocker.length > 0 ? { blockers: options.blocker } : {}),
        ...(options.risk !== undefined ? { risk: options.risk } : {}),
        ...(options.priorityScore !== undefined ? { priorityScore: Number(options.priorityScore) } : {}),
        ...(options.claimMode !== undefined ? { claimMode: options.claimMode } : {}),
        ...(options.doneWhen.length > 0 ? { completionCriteria: options.doneWhen } : {}),
        ...(options.lane !== undefined ? { lane: options.lane } : {}),
        ...(options.preferredAgent.length > 0 ? { preferredAgents: options.preferredAgent } : {}),
        ...(options.requireCapability.length > 0 ? { requiredCapabilities: options.requireCapability } : {}),
        ...(options.manualApproval !== undefined ? { manualApprovalRequired: parseBooleanFlag(options.manualApproval) } : {}),
        ...(options.plannerLocked !== undefined ? { plannerLocked: parseBooleanFlag(options.plannerLocked) } : {}),
      });
      console.log(`Updated ${updated.id}`);
    });

  task
    .command("list")
    .description("List tasks")
    .option("--json", "Emit machine-readable JSON")
    .action((options: { json?: boolean }) => {
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .cockpit workspace found. Run `cockpit init` first.");
      }
      const tasks = listTasks(workspace.cockpitDir);
      if (options.json) {
        console.log(JSON.stringify(tasks, null, 2));
        return;
      }
      if (tasks.length === 0) {
        console.log("No tasks yet.");
        return;
      }
      for (const item of tasks) {
        console.log(`${item.id} | ${item.repo} | ${item.status} | ${item.title}`);
      }
    });

  task
    .command("show")
    .description("Show one task")
    .argument("<task-id>", "Task id")
    .option("--json", "Emit machine-readable JSON")
    .action((taskId: string, options: { json?: boolean }) => {
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .cockpit workspace found. Run `cockpit init` first.");
      }
      const task = getTask(workspace.cockpitDir, taskId);
      if (!task) {
        throw new Error(`Unknown task: ${taskId}`);
      }
      if (options.json) {
        console.log(JSON.stringify(task, null, 2));
        return;
      }
      console.log(`Task: ${task.id}`);
      console.log(`Title: ${task.title}`);
      console.log(`Repo: ${task.repo}`);
      console.log(`Status: ${task.status}`);
      console.log(`Work item: ${task.work_item_id}`);
      if (task.scopes.length > 0) {
        console.log(`Scopes: ${task.scopes.join(", ")}`);
      }
    });

  task
    .command("move")
    .description("Move a task to a new status")
    .argument("<task-id>", "Task id")
    .argument("<status>", "Target task status")
    .action((taskId: string, status: "queued" | "planned" | "running" | "waiting" | "review" | "completed" | "blocked" | "canceled") => {
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .cockpit workspace found. Run `cockpit init` first.");
      }
      const task = updateTaskStatus(workspace.cockpitDir, taskId, status);
      console.log(`Moved ${task.id} to ${task.status}`);
    });

  task
    .command("block")
    .description("Block a task with one or more reasons")
    .argument("<task-id>", "Task id")
    .requiredOption("--reason <text>", "Blocking reason", collectValues, [])
    .action((taskId: string, options: { reason: string[] }) => {
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .cockpit workspace found. Run `cockpit init` first.");
      }
      const task = blockTask(workspace.cockpitDir, taskId, options.reason);
      console.log(`Blocked ${task.id}`);
    });

  task
    .command("unblock")
    .description("Remove one or all blockers and return the task to planned when clear")
    .argument("<task-id>", "Task id")
    .option("--reason <text>", "Specific blocker to remove", collectValues, [])
    .option("--all", "Remove every blocker")
    .action((taskId: string, options: { reason: string[]; all?: boolean }) => {
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .cockpit workspace found. Run `cockpit init` first.");
      }
      const task = unblockTask(workspace.cockpitDir, taskId, options.all ? undefined : options.reason);
      console.log(`Unblocked ${task.id}`);
    });

  task
    .command("plan")
    .description("Explain one task's scheduling state")
    .argument("<task-id>", "Task id")
    .option("--json", "Emit machine-readable JSON")
    .action((taskId: string, options: { json?: boolean }) => {
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .cockpit workspace found. Run `cockpit init` first.");
      }
      const config = loadConfig(workspace.cockpitDir);
      const plan = buildExecutionPlan(workspace.cockpitDir, config, { taskId });
      const decision = [...plan.runnable, ...plan.waiting, ...plan.blocked, ...plan.skipped][0];
      if (!decision) {
        throw new Error(`No schedulable decision found for task: ${taskId}`);
      }
      if (options.json) {
        console.log(JSON.stringify(decision, null, 2));
        return;
      }
      console.log(`Task: ${decision.taskId}`);
      console.log(`Action: ${decision.action}`);
      console.log(`Score: ${decision.score}`);
      if (decision.assignedAgentId) {
        console.log(`Assigned agent: ${decision.assignedAgentId}`);
      }
      console.log(`Reasons: ${decision.reasons.join(", ")}`);
    });
}
