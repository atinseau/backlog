import { Command } from "commander";
import { findWorkspace } from "@cockpit-ai/config";
import { buildWorkExecutionOutline, createWorkItem, getSource, getWorkItem, listSources, listWorkItems, resolveSplitRepos, splitWorkItem, updateWorkItem, upsertImportedWorkItems, updateWorkItemStatus } from "@cockpit-ai/core";
import { loadConfig } from "@cockpit-ai/config";
import { createConnector } from "@cockpit-ai/connectors";

function collectValues(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function parseScopeAssignments(assignments: string[] | undefined): Record<string, string[]> {
  const mapping: Record<string, string[]> = {};
  for (const assignment of assignments ?? []) {
    const separator = assignment.indexOf("=");
    if (separator <= 0 || separator === assignment.length - 1) {
      throw new Error(`Invalid scope mapping: ${assignment}. Expected repo=glob.`);
    }
    const repo = assignment.slice(0, separator);
    const scope = assignment.slice(separator + 1);
    mapping[repo] = [...(mapping[repo] ?? []), scope];
  }
  return mapping;
}

export function registerWorkCommand(program: Command): void {
  const work = program.command("work").description("Manage normalized work items");

  work
    .command("add")
    .description("Create a local work item")
    .requiredOption("--title <title>", "Work item title")
    .option("--description <description>", "Optional description")
    .option("--priority <priority>", "Priority (P0-P3)", "P2")
    .option("--repo <repo...>", "Target repo ids")
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
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .cockpit workspace found. Run `cockpit init` first.");
      }
      const item = createWorkItem(workspace.cockpitDir, {
        title: options.title,
        ...(options.description ? { description: options.description } : {}),
        ...(options.priority ? { priority: options.priority } : {}),
        ...(options.repo ? { repoTargets: options.repo } : {}),
        ...(options.label ? { labels: options.label } : {}),
        ...(options.acceptance ? { acceptanceCriteria: options.acceptance } : {}),
      });
      console.log(`Created work item ${item.id}`);
    });

  work
    .command("update")
    .description("Update work item metadata without editing YAML by hand")
    .argument("<work-item-id>", "Work item id")
    .option("--title <title>", "Work item title")
    .option("--description <description>", "Work item description")
    .option("--clear-description", "Remove the current description")
    .option("--priority <priority>", "Priority (P0-P3)")
    .option("--repo <repo>", "Replace target repos", collectValues, [])
    .option("--label <label>", "Replace labels", collectValues, [])
    .option("--acceptance <criterion>", "Replace acceptance criteria", collectValues, [])
    .option("--dependency <work-item-id>", "Replace work item dependencies", collectValues, [])
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
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .cockpit workspace found. Run `cockpit init` first.");
      }
      const item = updateWorkItem(workspace.cockpitDir, workItemId, {
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

  work
    .command("list")
    .description("List known work items")
    .option("--json", "Emit machine-readable JSON")
    .action((options: { json?: boolean }) => {
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .cockpit workspace found. Run `cockpit init` first.");
      }
      const items = listWorkItems(workspace.cockpitDir);
      if (options.json) {
        console.log(JSON.stringify(items, null, 2));
        return;
      }
      if (items.length === 0) {
        console.log("No work items yet.");
        return;
      }
      for (const item of items) {
        console.log(`${item.id} | ${item.priority} | ${item.status} | ${item.title}`);
      }
    });

  work
    .command("show")
    .description("Show one work item")
    .argument("<work-item-id>", "Work item id")
    .option("--json", "Emit machine-readable JSON")
    .action((workItemId: string, options: { json?: boolean }) => {
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .cockpit workspace found. Run `cockpit init` first.");
      }
      const item = getWorkItem(workspace.cockpitDir, workItemId);
      if (!item) {
        throw new Error(`Unknown work item: ${workItemId}`);
      }
      if (options.json) {
        console.log(JSON.stringify(item, null, 2));
        return;
      }
      console.log(`Work item: ${item.id}`);
      console.log(`Title: ${item.title}`);
      console.log(`Status: ${item.status}`);
      console.log(`Priority: ${item.priority}`);
      if (item.description) {
        console.log(`Description: ${item.description}`);
      }
      if (item.repo_targets.length > 0) {
        console.log(`Repos: ${item.repo_targets.join(", ")}`);
      }
    });

  work
    .command("move")
    .description("Move a work item to a new status")
    .argument("<work-item-id>", "Work item id")
    .argument("<status>", "Target status")
    .action((workItemId: string, status: "backlog" | "ready" | "in_progress" | "review" | "test" | "released" | "done" | "blocked") => {
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .cockpit workspace found. Run `cockpit init` first.");
      }
      const item = updateWorkItemStatus(workspace.cockpitDir, workItemId, status);
      console.log(`Moved ${item.id} to ${item.status}`);
    });

  work
    .command("plan")
    .description("Explain how a work item would execute")
    .argument("<work-item-id>", "Work item id")
    .option("--json", "Emit machine-readable JSON")
    .action((workItemId: string, options: { json?: boolean }) => {
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .cockpit workspace found. Run `cockpit init` first.");
      }
      const config = loadConfig(workspace.cockpitDir);
      const outline = buildWorkExecutionOutline(workspace.cockpitDir, config, workItemId);

      if (options.json) {
        console.log(JSON.stringify(outline, null, 2));
        return;
      }

      console.log(`Work item: ${outline.workItem.id}`);
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

  work
    .command("split")
    .description("Split one work item into executable repo-scoped tasks")
    .argument("<work-item-id>", "Work item id")
    .option("--repo <repo>", "Override one target repo", collectValues, [])
    .option("--scope <repo=glob>", "Map a scope to one target repo", collectValues, [])
    .option("--mode <mode>", "parallel or serial", "parallel")
    .option("--risk <risk>", "Risk level for created tasks")
    .option("--force", "Append split tasks even if the work item already has tasks")
    .option("--json", "Emit machine-readable JSON")
    .action((workItemId: string, options: {
      repo: string[];
      scope: string[];
      mode?: "parallel" | "serial";
      risk?: "low" | "medium" | "high";
      force?: boolean;
      json?: boolean;
    }) => {
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .cockpit workspace found. Run `cockpit init` first.");
      }
      const config = loadConfig(workspace.cockpitDir);
      const item = getWorkItem(workspace.cockpitDir, workItemId);
      if (!item) {
        throw new Error(`Unknown work item: ${workItemId}`);
      }

      const repos = resolveSplitRepos(config, item, options.repo);
      const result = splitWorkItem(workspace.cockpitDir, {
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

      console.log(`Split ${result.workItem.id} into ${result.createdTasks.length} task(s)`);
      console.log(`Mode: ${result.mode}`);
      for (const task of result.createdTasks) {
        const dependencyText = task.depends_on.length > 0 ? ` depends_on=${task.depends_on.join(",")}` : "";
        console.log(`- ${task.id} ${task.repo} ${task.title}${dependencyText}`);
      }
    });

  work
    .command("import")
    .description("Import work from one source or all enabled sources")
    .argument("[source-id]", "Optional source id")
    .option("--dry-run", "Fetch without writing work-items.yaml")
    .action(async (sourceId?: string, options?: { dryRun?: boolean }) => {
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .cockpit workspace found. Run `cockpit init` first.");
      }
      const sourcesToSync = sourceId
        ? [getSource(workspace.cockpitDir, sourceId)].filter(Boolean)
        : listSources(workspace.cockpitDir).filter((source) => source.enabled);
      if (sourcesToSync.length === 0) {
        throw new Error(sourceId ? `Unknown source: ${sourceId}` : "No enabled sources configured.");
      }

      for (const source of sourcesToSync) {
        const connector = createConnector(source!, workspace.root);
        const items = await connector.pull();
        if (!options?.dryRun) {
          upsertImportedWorkItems(workspace.cockpitDir, items);
        }
        console.log(`${source!.id}: ${items.length} item(s) ${options?.dryRun ? "fetched" : "imported"}`);
      }
    });
}
