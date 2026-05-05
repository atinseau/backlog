import { Command, Option } from "commander";
import { findProject } from "@backlog/config";
import {
  archiveTask,
  buildTaskExecutionOutline,
  createTask,
  getSource,
  getTask,
  listSources,
  listTasks,
  removeTask,
  resolveSplitRepos,
  setTaskEstimate,
  splitTask,
  unarchiveTask,
  updateTask,
  upsertImportedTasks,
  updateTaskStatus,
} from "@backlog/core";
import { loadConfig } from "@backlog/config";
import { createConnector } from "@backlog/connectors";

function collectValues(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function parseScopeAssignments(assignments: string[] | undefined): Record<string, string[]> {
  const mapping: Record<string, string[]> = {};
  for (const assignment of assignments ?? []) {
    const separator = assignment.indexOf("=");
    if (separator <= 0 || separator === assignment.length - 1) {
      throw new Error(`Invalid scope mapping: ${assignment}. Expected repository=glob.`);
    }
    const repo = assignment.slice(0, separator);
    const scope = assignment.slice(separator + 1);
    mapping[repo] = [...(mapping[repo] ?? []), scope];
  }
  return mapping;
}

export function registerTaskCommand(program: Command): void {
  const task = program.command("task").description("Manage tasks (kanban cards)");

  task
    .command("add")
    .description("Create a task")
    .requiredOption("--title <title>", "Task title")
    .option("--description <description>", "Optional description")
    .option("--priority <priority>", "Priority (P0-P3)", "P2")
    .option("--repository <repository...>", "Target repository ids")
    .addOption(new Option("--repo <repo...>", "Target repository ids").hideHelp())
    .option("--label <label...>", "Labels")
    .option("--acceptance <criterion...>", "Acceptance criteria")
    .action((options: {
      title: string;
      description?: string;
      priority?: "P0" | "P1" | "P2" | "P3";
      repo?: string[];
      label?: string[];
      acceptance?: string[];
    }) => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }
      const item = createTask(workspace.backlogDir, {
        title: options.title,
        ...(options.description ? { description: options.description } : {}),
        ...(options.priority ? { priority: options.priority } : {}),
        ...(options.repo ? { repoTargets: options.repo } : {}),
        ...(options.label ? { labels: options.label } : {}),
        ...(options.acceptance ? { acceptanceCriteria: options.acceptance } : {}),
      });
      console.log(`Created task ${item.id}`);
    });

  task
    .command("update")
    .description("Update task metadata without editing YAML by hand")
    .argument("<task-id>", "Task id")
    .option("--title <title>", "Task title")
    .option("--description <description>", "Task description")
    .option("--clear-description", "Remove the current description")
    .option("--priority <priority>", "Priority (P0-P3)")
    .option("--repository <repository>", "Replace target repositories", collectValues, [])
    .addOption(new Option("--repo <repo>", "Replace target repositories").argParser(collectValues).default([]).hideHelp())
    .option("--label <label>", "Replace labels", collectValues, [])
    .option("--acceptance <criterion>", "Replace acceptance criteria", collectValues, [])
    .option("--dependency <task-id>", "Replace task dependencies", collectValues, [])
    .option("--risk <risk>", "Planning risk")
    .option("--lane <lane>", "Preferred planning lane")
    .option("--clear-lane", "Clear the preferred planning lane")
    .option("--split-status <status>", "pending or done")
    .action((workItemId: string, options: {
      title?: string;
      description?: string;
      clearDescription?: boolean;
      priority?: "P0" | "P1" | "P2" | "P3";
      repo: string[];
      label: string[];
      acceptance: string[];
      dependency: string[];
      risk?: "low" | "medium" | "high";
      lane?: string;
      clearLane?: boolean;
      splitStatus?: "pending" | "done";
    }) => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }
      const item = updateTask(workspace.backlogDir, workItemId, {
        ...(options.title !== undefined ? { title: options.title } : {}),
        ...(options.description !== undefined ? { description: options.description } : {}),
        ...(options.clearDescription ? { clearDescription: true } : {}),
        ...(options.priority !== undefined ? { priority: options.priority } : {}),
        ...(options.repo.length > 0 ? { repoTargets: options.repo } : {}),
        ...(options.label.length > 0 ? { labels: options.label } : {}),
        ...(options.acceptance.length > 0 ? { acceptanceCriteria: options.acceptance } : {}),
        ...(options.dependency.length > 0 ? { dependencies: options.dependency } : {}),
        ...(options.risk !== undefined ? { planningRisk: options.risk } : {}),
        ...(options.lane !== undefined ? { preferredLane: options.lane } : {}),
        ...(options.clearLane ? { clearPreferredLane: true } : {}),
        ...(options.splitStatus !== undefined ? { splitStatus: options.splitStatus } : {}),
      });
      console.log(`Updated ${item.id}`);
    });

  task
    .command("list")
    .description("List known tasks (archived tasks hidden by default — pass --archived or --all to include)")
    .option("--status <status>", "Only show tasks in one status")
    .option("--priority <priority>", "Only show tasks at one priority")
    .option("--repository <repository>", "Only show tasks targeting one repository")
    .addOption(new Option("--repo <repo>", "Only show tasks targeting one repository").hideHelp())
    .option("--label <label>", "Only show tasks carrying one label")
    .option("--archived", "Only show archived tasks")
    .option("--all", "Show every task including archived")
    .option("--json", "Emit machine-readable JSON")
    .action((options: { json?: boolean; status?: string; priority?: string; repo?: string; label?: string; archived?: boolean; all?: boolean }) => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }
      const items = listTasks(workspace.backlogDir).filter((item) => {
        // Archive visibility — default hides archived; --archived flips
        // to only-archived; --all shows both. --archived wins over --all
        // if both are passed.
        const isArchived = Boolean(item.archived_at);
        if (options.archived) {
          if (!isArchived) return false;
        } else if (!options.all) {
          if (isArchived) return false;
        }
        if (options.status && item.status !== options.status) {
          return false;
        }
        if (options.priority && item.priority !== options.priority) {
          return false;
        }
        if (options.repo && !item.repo_targets.includes(options.repo)) {
          return false;
        }
        if (options.label && !item.labels.includes(options.label)) {
          return false;
        }
        return true;
      });
      if (options.json) {
        console.log(JSON.stringify(items, null, 2));
        return;
      }
      if (items.length === 0) {
        console.log("No tasks yet.");
        return;
      }
      for (const item of items) {
        console.log(`${item.id} | ${item.priority} | ${item.status} | ${item.title}`);
      }
    });

  task
    .command("show")
    .description("Show one task")
    .argument("<task-id>", "Task id")
    .option("--json", "Emit machine-readable JSON")
    .action((workItemId: string, options: { json?: boolean }) => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }
      const item = getTask(workspace.backlogDir, workItemId);
      if (!item) {
        throw new Error(`Unknown task: ${workItemId}`);
      }
      if (options.json) {
        console.log(JSON.stringify(item, null, 2));
        return;
      }
      console.log(`Task: ${item.id}`);
      console.log(`Title: ${item.title}`);
      console.log(`Status: ${item.status}`);
      console.log(`Priority: ${item.priority}`);
      if (item.description) {
        console.log(`Description: ${item.description}`);
      }
      if (item.repo_targets.length > 0) {
        console.log(`Repositories: ${item.repo_targets.join(", ")}`);
      }
    });

  task
    .command("remove")
    .description("Permanently delete a task (and optionally its sub-tasks)")
    .argument("<task-id>", "Task id")
    .option("--cascade", "Also remove subtasks linked to this task")
    .action((workItemId: string, options: { cascade?: boolean }) => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }
      const item = removeTask(workspace.backlogDir, workItemId, {
        ...(options.cascade ? { cascadeTasks: true } : {}),
      });
      console.log(`Removed ${item.id}`);
    });

  task
    .command("archive")
    .description("Archive a task — hides it from the default board / list (status preserved). Reversible with `unarchive`.")
    .argument("<task-id>", "Task id")
    .action((workItemId: string) => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }
      const item = archiveTask(workspace.backlogDir, workItemId);
      console.log(`Archived ${item.id}`);
    });

  task
    .command("unarchive")
    .description("Restore an archived task to the default views")
    .argument("<task-id>", "Task id")
    .action((workItemId: string) => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }
      const item = unarchiveTask(workspace.backlogDir, workItemId);
      console.log(`Unarchived ${item.id}`);
    });

  task
    .command("move")
    .description("Move a task to a new status")
    .argument("<task-id>", "Task id")
    .argument("<status>", "Target status")
    .action((workItemId: string, status: "backlog" | "ready" | "in_progress" | "review" | "test" | "released" | "done" | "blocked") => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }
      const item = updateTaskStatus(workspace.backlogDir, workItemId, status);
      console.log(`Moved ${item.id} to ${item.status}`);
    });

  task
    .command("plan")
    .description("Explain how a task would execute")
    .argument("<task-id>", "Task id")
    .option("--json", "Emit machine-readable JSON")
    .action((workItemId: string, options: { json?: boolean }) => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }
      const config = loadConfig(workspace.backlogDir);
      const outline = buildTaskExecutionOutline(workspace.backlogDir, config, workItemId);

      if (options.json) {
        console.log(JSON.stringify(outline, null, 2));
        return;
      }

      console.log(`Task: ${outline.workItem.id}`);
      console.log(`Title: ${outline.workItem.title}`);
      console.log("");
      console.log("Execution order");
      outline.tasks.forEach((task, index) => {
        console.log(`${index + 1}. ${task.id} ${task.repo} ${task.title}`);
        if (task.depends_on.length > 0) {
          console.log(`   depends on: ${task.depends_on.join(", ")}`);
        }
      });
      console.log("");
      console.log(`Max safe parallelism: ${outline.maxSafeParallelism}`);
      if (outline.recommendedNextTaskId) {
        console.log(`Recommended next task: ${outline.recommendedNextTaskId}`);
      }
    });

  task
    .command("split")
    .description("Split one task into executable repository-scoped subtasks")
    .argument("<task-id>", "Task id")
    .option("--repository <repository>", "Override one target repository", collectValues, [])
    .addOption(new Option("--repo <repo>", "Override one target repository").argParser(collectValues).default([]).hideHelp())
    .option("--scope <repository=glob>", "Map a scope to one target repository", collectValues, [])
    .option("--mode <mode>", "parallel or serial", "parallel")
    .option("--risk <risk>", "Risk level for created tasks")
    .option("--force", "Append subtasks even if the task already has subtasks")
    .option("--json", "Emit machine-readable JSON")
    .action((workItemId: string, options: {
      repo: string[];
      scope: string[];
      mode?: "parallel" | "serial";
      risk?: "low" | "medium" | "high";
      force?: boolean;
      json?: boolean;
    }) => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }
      const config = loadConfig(workspace.backlogDir);
      const item = getTask(workspace.backlogDir, workItemId);
      if (!item) {
        throw new Error(`Unknown task: ${workItemId}`);
      }

      const repos = resolveSplitRepos(config, item, options.repo);
      const result = splitTask(workspace.backlogDir, {
        workItemId,
        repos,
        mode: options.mode === "serial" ? "serial" : "parallel",
        scopeByRepo: parseScopeAssignments(options.scope),
        ...(options.risk ? { risk: options.risk } : {}),
        ...(options.force ? { force: true } : {}),
      });

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(`Split ${result.workItem.id} into ${result.createdTasks.length} subtask(s)`);
      console.log(`Mode: ${result.mode}`);
      for (const task of result.createdTasks) {
        const dependencyText = task.depends_on.length > 0 ? ` depends_on=${task.depends_on.join(",")}` : "";
        console.log(`- ${task.id} ${task.repo} ${task.title}${dependencyText}`);
      }
    });

  task
    .command("import")
    .description("Import work from one source or all enabled sources")
    .argument("[source-id]", "Optional source id")
    .option("--dry-run", "Fetch without writing tasks.yaml")
    .action(async (sourceId?: string, options?: { dryRun?: boolean }) => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }
      const sourcesToSync = sourceId
        ? [getSource(workspace.backlogDir, sourceId)].filter(Boolean)
        : listSources(workspace.backlogDir).filter((source) => source.enabled);
      if (sourcesToSync.length === 0) {
        throw new Error(sourceId ? `Unknown source: ${sourceId}` : "No enabled sources configured.");
      }

      for (const source of sourcesToSync) {
        const connector = createConnector(source!, workspace.root, workspace.backlogDir);
        const items = await connector.pull();
        if (!options?.dryRun) {
          upsertImportedTasks(workspace.backlogDir, items);
        }
        console.log(`${source!.id}: ${items.length} item(s) ${options?.dryRun ? "fetched" : "imported"}`);
      }
    });

  task
    .command("estimate")
    .description("Set or clear the task override estimate (in seconds)")
    .argument("<task-id>", "Task id")
    .argument("[seconds]", "Duration in seconds (omit with --clear)")
    .option("--clear", "Remove the override; the estimate falls back to the sum of subtask estimates")
    .action((workItemId: string, secondsArg: string | undefined, options: { clear?: boolean }) => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }
      if (options.clear) {
        setTaskEstimate(workspace.backlogDir, workItemId, null);
        console.log(`Cleared estimate on ${workItemId}`);
        return;
      }
      if (!secondsArg) {
        throw new Error("Provide seconds, or pass --clear.");
      }
      const seconds = parseInt(secondsArg, 10);
      if (!Number.isInteger(seconds) || seconds <= 0) {
        throw new Error("seconds must be a positive integer");
      }
      const updated = setTaskEstimate(workspace.backlogDir, workItemId, seconds);
      console.log(`Set estimate to ${updated.estimated_duration_seconds}s on ${updated.id}`);
    });
}
