import { Command } from "commander";
import { findWorkspace } from "@cockpit-ai/config";
import { buildExecutionPlan, createTask, getTask, listTasks, updateTaskStatus } from "@cockpit-ai/core";
import { loadConfig } from "@cockpit-ai/config";

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
    .action((options: {
      workItem: string;
      title: string;
      repo: string;
      scope?: string[];
      dependsOn?: string[];
      blocker?: string[];
      risk?: "low" | "medium" | "high";
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
      });
      console.log(`Created task ${created.id}`);
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
