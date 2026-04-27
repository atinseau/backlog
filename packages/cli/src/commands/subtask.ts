import { Command } from "commander";
import { findProject } from "@backlog/config";
import {
  blockTask,
  buildExecutionPlan,
  clearSubTaskEstimate,
  createSubTask,
  getSubTask,
  listSubTasks,
  removeSubTask,
  setSubTaskEstimate,
  setSubTaskProgress,
  unblockTask,
  updateSubTask,
  updateSubTaskStatus,
} from "@backlog/core";
import { loadConfig } from "@backlog/config";

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

export function registerSubTaskCommand(program: Command): void {
  const task = program.command("subtask").description("Manage executable subtasks (per-repo execution units)");

  task
    .command("add")
    .description("Create a task for a work item")
    .requiredOption("--work-item <id>", "Parent work item id")
    .requiredOption("--title <title>", "SubTask title")
    .requiredOption("--repo <repo>", "Target repo id")
    .option("--scope <scope...>", "SubTask scopes")
    .option("--depends-on <task...>", "SubTask dependencies")
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
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }
      const created = createSubTask(workspace.backlogDir, {
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
    .argument("<task-id>", "SubTask id")
    .option("--title <title>", "SubTask title")
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
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }

      const updated = updateSubTask(workspace.backlogDir, taskId, {
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
    .option("--repo <repo>", "Only show tasks for one repo")
    .option("--status <status>", "Only show tasks in one status")
    .option("--work-item <id>", "Only show tasks for one work item")
    .option("--json", "Emit machine-readable JSON")
    .action((options: { json?: boolean; repo?: string; status?: string; workItem?: string }) => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }
      const tasks = listSubTasks(workspace.backlogDir).filter((item) => {
        if (options.repo && item.repo !== options.repo) {
          return false;
        }
        if (options.status && item.status !== options.status) {
          return false;
        }
        if (options.workItem && item.work_item_id !== options.workItem) {
          return false;
        }
        return true;
      });
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
    .command("remove")
    .description("Remove a task and drop dependency references to it")
    .argument("<task-id>", "SubTask id")
    .action((taskId: string) => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }
      const task = removeSubTask(workspace.backlogDir, taskId);
      console.log(`Removed ${task.id}`);
    });

  task
    .command("show")
    .description("Show one task")
    .argument("<task-id>", "SubTask id")
    .option("--json", "Emit machine-readable JSON")
    .action((taskId: string, options: { json?: boolean }) => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }
      const task = getSubTask(workspace.backlogDir, taskId);
      if (!task) {
        throw new Error(`Unknown task: ${taskId}`);
      }
      if (options.json) {
        console.log(JSON.stringify(task, null, 2));
        return;
      }
      console.log(`SubTask: ${task.id}`);
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
    .argument("<task-id>", "SubTask id")
    .argument("<status>", "Target task status")
    .action((taskId: string, status: "queued" | "planned" | "running" | "waiting" | "review" | "completed" | "blocked" | "canceled") => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }
      const task = updateSubTaskStatus(workspace.backlogDir, taskId, status);
      console.log(`Moved ${task.id} to ${task.status}`);
    });

  task
    .command("block")
    .description("Block a task with one or more reasons")
    .argument("<task-id>", "SubTask id")
    .requiredOption("--reason <text>", "Blocking reason", collectValues, [])
    .action((taskId: string, options: { reason: string[] }) => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }
      const task = blockTask(workspace.backlogDir, taskId, options.reason);
      console.log(`Blocked ${task.id}`);
    });

  task
    .command("unblock")
    .description("Remove one or all blockers and return the task to planned when clear")
    .argument("<task-id>", "SubTask id")
    .option("--reason <text>", "Specific blocker to remove", collectValues, [])
    .option("--all", "Remove every blocker")
    .action((taskId: string, options: { reason: string[]; all?: boolean }) => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }
      const task = unblockTask(workspace.backlogDir, taskId, options.all ? undefined : options.reason);
      console.log(`Unblocked ${task.id}`);
    });

  task
    .command("plan")
    .description("Explain one task's scheduling state")
    .argument("<task-id>", "SubTask id")
    .option("--json", "Emit machine-readable JSON")
    .action((taskId: string, options: { json?: boolean }) => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }
      const config = loadConfig(workspace.backlogDir);
      const plan = buildExecutionPlan(workspace.backlogDir, config, { taskId });
      const decision = [...plan.runnable, ...plan.waiting, ...plan.blocked, ...plan.skipped][0];
      if (!decision) {
        throw new Error(`No schedulable decision found for task: ${taskId}`);
      }
      if (options.json) {
        console.log(JSON.stringify(decision, null, 2));
        return;
      }
      console.log(`SubTask: ${decision.taskId}`);
      console.log(`Action: ${decision.action}`);
      console.log(`Score: ${decision.score}`);
      if (decision.assignedAgentId) {
        console.log(`Assigned agent: ${decision.assignedAgentId}`);
      }
      console.log(`Reasons: ${decision.reasons.join(", ")}`);
    });

  task
    .command("estimate")
    .description("Set or clear a manual estimate (in seconds)")
    .argument("<task-id>", "SubTask id")
    .argument("[seconds]", "Duration in seconds (omit with --clear)")
    .option("--clear", "Remove the manual estimate")
    .action((taskId: string, secondsArg: string | undefined, options: { clear?: boolean }) => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }
      if (options.clear) {
        clearSubTaskEstimate(workspace.backlogDir, taskId);
        console.log(`Cleared estimate on ${taskId}`);
        return;
      }
      if (!secondsArg) {
        throw new Error("Provide seconds, e.g. `backlog task estimate TASK-x 1800`, or pass --clear.");
      }
      const seconds = parseInt(secondsArg, 10);
      if (!Number.isInteger(seconds) || seconds <= 0) {
        throw new Error("seconds must be a positive integer");
      }
      const updated = setSubTaskEstimate(workspace.backlogDir, taskId, seconds, "manual");
      console.log(`Set estimate to ${updated.estimated_duration_seconds}s on ${updated.id}`);
    });

  task
    .command("progress")
    .description("Set the progress percent reported by the agent (0-100)")
    .argument("<task-id>", "SubTask id")
    .argument("<percent>", "Progress percent")
    .action((taskId: string, percentArg: string) => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }
      const percent = parseInt(percentArg, 10);
      if (!Number.isFinite(percent)) {
        throw new Error("percent must be a number");
      }
      const updated = setSubTaskProgress(workspace.backlogDir, taskId, percent);
      console.log(`Set progress to ${updated.progress_percent}% on ${updated.id}`);
    });
}
