import { Command, Option } from "commander";
import { findProject } from "@backlog/config";
import { createConnector } from "@backlog/connectors";
import {
  addSource,
  getSource,
  getTask,
  hasPendingSyncConflictsForTask,
  listPendingSyncConflicts,
  listSources,
  listTasks,
  primarySourceLink,
  removeSource,
  resolveSyncConflict,
  resolveSyncConflictsForTask,
  setSourceEnabled,
  updateSource,
  upsertImportedTasks,
} from "@backlog/core";
import type { SourceConfig, SourceKind } from "@backlog/schemas";

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
    .argument("<kind>", "Source kind: markdown, csv, jira, github")
    .requiredOption("--id <id>", "Source id")
    .option("--path <path>", "Path for markdown or csv")
    .option("--base-url <url>", "Base URL for Jira")
    .option("--jql <jql>", "JQL query for Jira")
    .option("--email-env <env>", "Env var name for Jira email", "JIRA_EMAIL")
    .option("--token-env <env>", "Env var name for Jira API token (or GitHub PAT)", "JIRA_API_TOKEN")
    .option("--repository <owner/name>", "Repository for GitHub (e.g. octocat/hello-world)")
    .addOption(new Option("--repo <owner/name>", "Repository for GitHub (e.g. octocat/hello-world)").hideHelp())
    .option("--labels <labels>", "Comma-separated GitHub label filter")
    .option("--state <state>", "GitHub issue state filter (open | closed | all)", "open")
    .action((kind: SourceKind, options: {
      id: string;
      path?: string;
      baseUrl?: string;
      jql?: string;
      emailEnv?: string;
      tokenEnv?: string;
      repo?: string;
      labels?: string;
      state?: string;
    }) => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
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
        case "github":
          if (!options.repo) {
            throw new Error("--repository <owner/name> is required for github");
          }
          if (!/^[^/\s]+\/[^/\s]+$/.test(options.repo)) {
            throw new Error(`--repository must be in <owner/name> form, got: ${options.repo}`);
          }
          source = {
            id: options.id,
            kind,
            enabled: true,
            config: {
              repo: options.repo,
              ...(options.labels ? { labels: options.labels.split(",").map((l) => l.trim()).filter(Boolean) } : {}),
              state: options.state ?? "open",
            },
            auth: {
              strategy: "env",
              refs: {
                token: options.tokenEnv ?? "GITHUB_TOKEN",
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
        default: {
          // Exhaustiveness check: if SourceKind grows another variant, the
          // never-cast forces a compile error here so we don't silently
          // forget to handle it.
          const _exhaustive: never = kind;
          throw new Error(`Unsupported source kind: ${String(_exhaustive)}`);
        }
      }

      addSource(workspace.backlogDir, source);
      console.log(`Added source ${source.id}`);
    });

  sources
    .command("enable")
    .description("Enable one configured source")
    .argument("<source-id>", "Source id")
    .action((sourceId: string) => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }
      const source = setSourceEnabled(workspace.backlogDir, sourceId, true);
      console.log(`Enabled ${source.id}`);
    });

  sources
    .command("disable")
    .description("Disable one configured source")
    .argument("<source-id>", "Source id")
    .action((sourceId: string) => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }
      const source = setSourceEnabled(workspace.backlogDir, sourceId, false);
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
    .option("--source-of-truth <mode>", "external or backlog")
    .action((sourceId: string, options: {
      config: string[];
      authRef: string[];
      authStrategy?: string;
      mapping: string[];
      pull?: string;
      pushStatus?: string;
      pushComments?: string;
      sourceOfTruth?: "external" | "backlog";
    }) => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }
      const source = updateSource(workspace.backlogDir, sourceId, {
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
    .option("--kind <kind>", "Only show sources of one kind")
    .option("--enabled <enabled>", "Only show enabled or disabled sources")
    .option("--json", "Emit machine-readable JSON")
    .action((options: { json?: boolean; kind?: string; enabled?: string }) => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }
      const sources = listSources(workspace.backlogDir).filter((source) => {
        if (options.kind && source.kind !== options.kind) {
          return false;
        }
        if (options.enabled !== undefined && source.enabled !== parseBooleanFlag(options.enabled)) {
          return false;
        }
        return true;
      });
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
    .description("Remove one source, optionally unlinking tasks that still reference it")
    .argument("<source-id>", "Source id")
    .option("--force", "Also unlink this source from existing tasks")
    .action((sourceId: string, options: { force?: boolean }) => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }
      const source = removeSource(workspace.backlogDir, sourceId, {
        ...(options.force ? { force: true } : {}),
      });
      console.log(`Removed ${source.id}`);
    });

  sources
    .command("validate")
    .description("Validate one source or all sources")
    .argument("[source-id]", "Optional source id")
    .action(async (sourceId?: string) => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }
      const sourcesToValidate = sourceId
        ? [getSource(workspace.backlogDir, sourceId)].filter(Boolean)
        : listSources(workspace.backlogDir);
      if (sourcesToValidate.length === 0) {
        throw new Error(sourceId ? `Unknown source: ${sourceId}` : "No sources configured.");
      }
      for (const source of sourcesToValidate) {
        const connector = createConnector(source!, workspace.root, workspace.backlogDir);
        const result = await connector.validate();
        console.log(`${source!.id}: ${result.ok ? "ok" : "invalid"} (${result.details.join(", ")})`);
      }
    });

  sources
    .command("sync")
    .description("Pull work from one source or all enabled sources")
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
        console.log(`${source!.id}: ${items.length} item(s) ${options?.dryRun ? "fetched" : "synced"}`);
      }
    });

  sources
    .command("push")
    .description("Push a task status or comment back to its source when supported")
    .argument("[task-id]", "Task id")
    .option("--comment <text>", "Optional comment to push")
    .option("--all", "Push every source-linked task that supports push")
    .option("--allow-conflicts", "Allow push even when the task still has pending sync conflicts")
    .action(async (taskId: string | undefined, options: { comment?: string; all?: boolean; allowConflicts?: boolean }) => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }
      if (!taskId && !options.all) {
        throw new Error("sources push requires a <task-id> or --all.");
      }
      if (options.all && options.comment) {
        throw new Error("--comment can only be used when pushing a single task.");
      }

      const items = options.all
        ? listTasks(workspace.backlogDir).filter((item) => primarySourceLink(item)?.source_ref)
        : [getTask(workspace.backlogDir, taskId!)].filter(Boolean);

      if (items.length === 0) {
        throw new Error(options.all ? "No source-linked tasks to push." : `Unknown task: ${taskId}`);
      }

      for (const task of items) {
        if (!task) {
          continue;
        }
        if (!options.allowConflicts && hasPendingSyncConflictsForTask(workspace.backlogDir, task.id)) {
          throw new Error(`Task ${task.id} still has pending sync conflicts. Resolve them first or pass --allow-conflicts.`);
        }

        const sourceLink = primarySourceLink(task);
        if (!sourceLink?.source_ref) {
          if (!options.all) {
            throw new Error(`Task ${task.id} has no primary source link.`);
          }
          continue;
        }
        const source = getSource(workspace.backlogDir, sourceLink.source_ref);
        if (!source) {
          throw new Error(`Unknown source: ${sourceLink.source_ref}`);
        }
        const connector = createConnector(source, workspace.root, workspace.backlogDir);
        if (!connector.push) {
          if (!options.all) {
            throw new Error(`Source ${source.id} does not support push.`);
          }
          continue;
        }
        await connector.push({
          externalId: sourceLink.external_id,
          status: task.status,
          ...(options.comment ? { comment: options.comment } : {}),
        });
        console.log(`Pushed ${task.id} to ${source.id}`);
      }
    });

  sources
    .command("conflicts")
    .description("List pending sync conflicts")
    .option("--json", "Emit machine-readable JSON")
    .action((options: { json?: boolean }) => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }
      const conflicts = listPendingSyncConflicts(workspace.backlogDir);
      if (options.json) {
        console.log(JSON.stringify(conflicts, null, 2));
        return;
      }
      if (conflicts.length === 0) {
        console.log("No pending sync conflicts.");
        return;
      }
      for (const conflict of conflicts) {
        console.log(`${conflict.id} | ${conflict.task_id} | ${conflict.field} | local=${conflict.local_value} | external=${conflict.external_value}`);
      }
    });

  sources
    .command("resolve")
    .description("Resolve one sync conflict")
    .argument("[conflict-id]", "Sync conflict id")
    .option("--task <id>", "Resolve every pending conflict for one task")
    .requiredOption("--use <resolution>", "external or local")
    .action((conflictId: string | undefined, options: { use: "external" | "local"; task?: string }) => {
      const workspace = findProject();
      if (!workspace) {
        throw new Error("No .backlog project found. Run `backlog init` first.");
      }
      if (options.use !== "external" && options.use !== "local") {
        throw new Error("--use must be external or local");
      }
      if (!conflictId && !options.task) {
        throw new Error("sources resolve requires a <conflict-id> or --task.");
      }

      if (options.task) {
        const conflicts = resolveSyncConflictsForTask(workspace.backlogDir, options.task, options.use);
        if (conflicts.length === 0) {
          console.log(`No pending conflicts for ${options.task}`);
          return;
        }
        console.log(`Resolved ${conflicts.length} conflict(s) for ${options.task} using ${options.use}`);
        return;
      }

      const conflict = resolveSyncConflict(workspace.backlogDir, conflictId!, options.use);
      console.log(`Resolved ${conflict.id} using ${options.use}`);
    });
}
