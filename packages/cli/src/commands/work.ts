import { Command } from "commander";
import { findWorkspace } from "@cockpit-ai/config";
import { createWorkItem, getWorkItem, listWorkItems, updateWorkItemStatus } from "@cockpit-ai/core";

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
}
