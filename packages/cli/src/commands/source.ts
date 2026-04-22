import { Command } from "commander";
import { findWorkspace } from "@cockpit-ai/config";
import { createConnector } from "@cockpit-ai/connectors";
import {
  addSource,
  getSource,
  getWorkItem,
  hasPendingSyncConflictsForWorkItem,
  listPendingSyncConflicts,
  listSources,
  listWorkItems,
  primarySourceLink,
  removeSource,
  resolveSyncConflict,
  resolveSyncConflictsForWorkItem,
  setSourceEnabled,
  updateSource,
  upsertImportedWorkItems,
} from "@cockpit-ai/core";
import type { SourceConfig, SourceKind } from "@cockpit-ai/schemas";

function collectValues(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function parseKeyValuePairs(pairs: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const pair of pairs) {
    const separator = pair.indexOf("=");
    if (separator <= 0 || separator === pair.length - 1) {
      throw new Error(`Invalid key/value pair: ${pair}. Expected KEY=value.`);
    }
    result[pair.slice(0, separator)] = pair.slice(separator + 1);
  }
  return result;
}

function parseBooleanFlag(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (["true", "yes", "1"].includes(normalized)) {
    return true;
  }
  if (["false", "no", "0"].includes(normalized)) {
    return false;
  }
  throw new Error(`Expected a boolean value, received: ${value}`);
}

export function registerSourceCommand(program: Command): void {
  const sources = program.command("sources").description("Manage planning source connectors");

  sources
    .command("add")
    .description("Add a source connector")
    .argument("<kind>", "Source kind: markdown, csv, jira")
    .requiredOption("--id <id>", "Source id")
    .option("--path <path>", "Path for markdown or csv")
    .option("--base-url <url>", "Base URL for Jira")
    .option("--jql <jql>", "JQL query for Jira")
    .option("--email-env <env>", "Env var name for Jira email", "JIRA_EMAIL")
    .option("--token-env <env>", "Env var name for Jira API token", "JIRA_API_TOKEN")
    .action((kind: SourceKind, options: {
      id: string;
      path?: string;
      baseUrl?: string;
      jql?: string;
      emailEnv?: string;
      tokenEnv?: string;
    }) => {
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .cockpit workspace found. Run `cockpit init` first.");
      }

      let source: SourceConfig;
      switch (kind) {
        case "markdown":
        case "csv":
          if (!options.path) {
            throw new Error(`--path is required for ${kind}`);
          }
          source = {
            id: options.id,
            kind,
            enabled: true,
            config: {
              path: options.path,
            },
            auth: {
              strategy: "none",
              refs: {},
            },
            mapping: {},
            sync: {
              pull: true,
              push_status: false,
              push_comments: false,
              source_of_truth: "external",
            },
          };
          break;
        case "jira":
          if (!options.baseUrl) {
            throw new Error("--base-url is required for jira");
          }
          source = {
            id: options.id,
            kind,
            enabled: true,
            config: {
              base_url: options.baseUrl,
              jql: options.jql ?? "statusCategory != Done ORDER BY updated DESC",
              page_size: 50,
            },
            auth: {
              strategy: "env",
              refs: {
                email: options.emailEnv ?? "JIRA_EMAIL",
                api_token: options.tokenEnv ?? "JIRA_API_TOKEN",
              },
            },
            mapping: {},
            sync: {
              pull: true,
              push_status: false,
              push_comments: false,
              source_of_truth: "external",
            },
          };
          break;
      }

      addSource(workspace.cockpitDir, source);
      console.log(`Added source ${source.id}`);
    });

  sources
    .command("enable")
    .description("Enable one configured source")
    .argument("<source-id>", "Source id")
    .action((sourceId: string) => {
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .cockpit workspace found. Run `cockpit init` first.");
      }
      const source = setSourceEnabled(workspace.cockpitDir, sourceId, true);
      console.log(`Enabled ${source.id}`);
    });

  sources
    .command("disable")
    .description("Disable one configured source")
    .argument("<source-id>", "Source id")
    .action((sourceId: string) => {
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .cockpit workspace found. Run `cockpit init` first.");
      }
      const source = setSourceEnabled(workspace.cockpitDir, sourceId, false);
      console.log(`Disabled ${source.id}`);
    });

  sources
    .command("update")
    .description("Update one source without editing sources.yaml by hand")
    .argument("<source-id>", "Source id")
    .option("--config <key=value>", "Replace source config entries", collectValues, [])
    .option("--auth-ref <key=value>", "Replace source auth refs", collectValues, [])
    .option("--auth-strategy <strategy>", "Override auth strategy")
    .option("--mapping <key=value>", "Replace source mapping entries", collectValues, [])
    .option("--pull <enabled>", "Whether this source can pull")
    .option("--push-status <enabled>", "Whether this source can push statuses")
    .option("--push-comments <enabled>", "Whether this source can push comments")
    .option("--source-of-truth <mode>", "external or cockpit")
    .action((sourceId: string, options: {
      config: string[];
      authRef: string[];
      authStrategy?: string;
      mapping: string[];
      pull?: string;
      pushStatus?: string;
      pushComments?: string;
      sourceOfTruth?: "external" | "cockpit";
    }) => {
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .cockpit workspace found. Run `cockpit init` first.");
      }
      const source = updateSource(workspace.cockpitDir, sourceId, {
        ...(options.config.length > 0 ? { config: parseKeyValuePairs(options.config) } : {}),
        ...(options.authRef.length > 0 ? { authRefs: parseKeyValuePairs(options.authRef) } : {}),
        ...(options.authStrategy !== undefined ? { authStrategy: options.authStrategy } : {}),
        ...(options.mapping.length > 0 ? { mapping: parseKeyValuePairs(options.mapping) } : {}),
        ...(options.pull !== undefined ? { pull: parseBooleanFlag(options.pull) } : {}),
        ...(options.pushStatus !== undefined ? { pushStatus: parseBooleanFlag(options.pushStatus) } : {}),
        ...(options.pushComments !== undefined ? { pushComments: parseBooleanFlag(options.pushComments) } : {}),
        ...(options.sourceOfTruth !== undefined ? { sourceOfTruth: options.sourceOfTruth } : {}),
      });
      console.log(`Updated ${source.id}`);
    });

  sources
    .command("list")
    .description("List configured sources")
    .option("--json", "Emit machine-readable JSON")
    .action((options: { json?: boolean }) => {
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .cockpit workspace found. Run `cockpit init` first.");
      }
      const sources = listSources(workspace.cockpitDir);
      if (options.json) {
        console.log(JSON.stringify(sources, null, 2));
        return;
      }
      if (sources.length === 0) {
        console.log("No sources configured.");
        return;
      }
      for (const source of sources) {
        console.log(`${source.id} | ${source.kind} | enabled=${source.enabled}`);
      }
    });

  sources
    .command("remove")
    .description("Remove one source, optionally unlinking work items that still reference it")
    .argument("<source-id>", "Source id")
    .option("--force", "Also unlink this source from existing work items")
    .action((sourceId: string, options: { force?: boolean }) => {
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .cockpit workspace found. Run `cockpit init` first.");
      }
      const source = removeSource(workspace.cockpitDir, sourceId, {
        ...(options.force ? { force: true } : {}),
      });
      console.log(`Removed ${source.id}`);
    });

  sources
    .command("validate")
    .description("Validate one source or all sources")
    .argument("[source-id]", "Optional source id")
    .action(async (sourceId?: string) => {
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .cockpit workspace found. Run `cockpit init` first.");
      }
      const sourcesToValidate = sourceId
        ? [getSource(workspace.cockpitDir, sourceId)].filter(Boolean)
        : listSources(workspace.cockpitDir);
      if (sourcesToValidate.length === 0) {
        throw new Error(sourceId ? `Unknown source: ${sourceId}` : "No sources configured.");
      }
      for (const source of sourcesToValidate) {
        const connector = createConnector(source!, workspace.root);
        const result = await connector.validate();
        console.log(`${source!.id}: ${result.ok ? "ok" : "invalid"} (${result.details.join(", ")})`);
      }
    });

  sources
    .command("sync")
    .description("Pull work from one source or all enabled sources")
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
        console.log(`${source!.id}: ${items.length} item(s) ${options?.dryRun ? "fetched" : "synced"}`);
      }
    });

  sources
    .command("push")
    .description("Push a work item status or comment back to its source when supported")
    .argument("[work-item-id]", "Work item id")
    .option("--comment <text>", "Optional comment to push")
    .option("--all", "Push every source-linked work item that supports push")
    .option("--allow-conflicts", "Allow push even when the work item still has pending sync conflicts")
    .action(async (workItemId: string | undefined, options: { comment?: string; all?: boolean; allowConflicts?: boolean }) => {
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .cockpit workspace found. Run `cockpit init` first.");
      }
      if (!workItemId && !options.all) {
        throw new Error("sources push requires a <work-item-id> or --all.");
      }
      if (options.all && options.comment) {
        throw new Error("--comment can only be used when pushing a single work item.");
      }

      const items = options.all
        ? listWorkItems(workspace.cockpitDir).filter((item) => primarySourceLink(item)?.source_ref)
        : [getWorkItem(workspace.cockpitDir, workItemId!)].filter(Boolean);

      if (items.length === 0) {
        throw new Error(options.all ? "No source-linked work items to push." : `Unknown work item: ${workItemId}`);
      }

      for (const workItem of items) {
        if (!workItem) {
          continue;
        }
        if (!options.allowConflicts && hasPendingSyncConflictsForWorkItem(workspace.cockpitDir, workItem.id)) {
          throw new Error(`Work item ${workItem.id} still has pending sync conflicts. Resolve them first or pass --allow-conflicts.`);
        }

        const sourceLink = primarySourceLink(workItem);
        if (!sourceLink?.source_ref) {
          if (!options.all) {
            throw new Error(`Work item ${workItem.id} has no primary source link.`);
          }
          continue;
        }
        const source = getSource(workspace.cockpitDir, sourceLink.source_ref);
        if (!source) {
          throw new Error(`Unknown source: ${sourceLink.source_ref}`);
        }
        const connector = createConnector(source, workspace.root);
        if (!connector.push) {
          if (!options.all) {
            throw new Error(`Source ${source.id} does not support push.`);
          }
          continue;
        }
        await connector.push({
          externalId: sourceLink.external_id,
          status: workItem.status,
          ...(options.comment ? { comment: options.comment } : {}),
        });
        console.log(`Pushed ${workItem.id} to ${source.id}`);
      }
    });

  sources
    .command("conflicts")
    .description("List pending sync conflicts")
    .option("--json", "Emit machine-readable JSON")
    .action((options: { json?: boolean }) => {
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .cockpit workspace found. Run `cockpit init` first.");
      }
      const conflicts = listPendingSyncConflicts(workspace.cockpitDir);
      if (options.json) {
        console.log(JSON.stringify(conflicts, null, 2));
        return;
      }
      if (conflicts.length === 0) {
        console.log("No pending sync conflicts.");
        return;
      }
      for (const conflict of conflicts) {
        console.log(`${conflict.id} | ${conflict.work_item_id} | ${conflict.field} | local=${conflict.local_value} | external=${conflict.external_value}`);
      }
    });

  sources
    .command("resolve")
    .description("Resolve one sync conflict")
    .argument("[conflict-id]", "Sync conflict id")
    .option("--work-item <id>", "Resolve every pending conflict for one work item")
    .requiredOption("--use <resolution>", "external or local")
    .action((conflictId: string | undefined, options: { use: "external" | "local"; workItem?: string }) => {
      const workspace = findWorkspace();
      if (!workspace) {
        throw new Error("No .cockpit workspace found. Run `cockpit init` first.");
      }
      if (options.use !== "external" && options.use !== "local") {
        throw new Error("--use must be external or local");
      }
      if (!conflictId && !options.workItem) {
        throw new Error("sources resolve requires a <conflict-id> or --work-item.");
      }

      if (options.workItem) {
        const conflicts = resolveSyncConflictsForWorkItem(workspace.cockpitDir, options.workItem, options.use);
        if (conflicts.length === 0) {
          console.log(`No pending conflicts for ${options.workItem}`);
          return;
        }
        console.log(`Resolved ${conflicts.length} conflict(s) for ${options.workItem} using ${options.use}`);
        return;
      }

      const conflict = resolveSyncConflict(workspace.cockpitDir, conflictId!, options.use);
      console.log(`Resolved ${conflict.id} using ${options.use}`);
    });
}
