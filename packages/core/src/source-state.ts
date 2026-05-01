import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { sourcesFileSchema, type SourceConfig, type SourcesFile, type Task } from "@backlog/schemas";
import { readTasksFile, writeTasksFile } from "./state-files.js";
import { recordStatusConflict } from "./sync-conflicts.js";

function sourcesPath(backlogDir: string): string {
  return path.join(backlogDir, "sources.yaml");
}

export function readSourcesFile(backlogDir: string): SourcesFile {
  const parsed = YAML.parse(fs.readFileSync(sourcesPath(backlogDir), "utf8")) as unknown;
  return sourcesFileSchema.parse(parsed);
}

export function writeSourcesFile(backlogDir: string, file: SourcesFile): void {
  fs.writeFileSync(sourcesPath(backlogDir), YAML.stringify(file), "utf8");
}

export function listSources(backlogDir: string): SourceConfig[] {
  return readSourcesFile(backlogDir).sources;
}

export function addSource(backlogDir: string, source: SourceConfig): SourceConfig {
  const file = readSourcesFile(backlogDir);
  if (file.sources.some((candidate) => candidate.id === source.id)) {
    throw new Error(`Source already exists: ${source.id}`);
  }
  file.sources.push(source);
  writeSourcesFile(backlogDir, file);
  return source;
}

export function getSource(backlogDir: string, id: string): SourceConfig | null {
  return listSources(backlogDir).find((source) => source.id === id) ?? null;
}

export interface UpdateSourceInput {
  enabled?: boolean;
  config?: Record<string, unknown>;
  authStrategy?: string;
  authRefs?: Record<string, string>;
  mapping?: Record<string, unknown>;
  pull?: boolean;
  pushStatus?: boolean;
  pushComments?: boolean;
  sourceOfTruth?: "external" | "backlog";
}

export function updateSource(backlogDir: string, id: string, input: UpdateSourceInput): SourceConfig {
  const file = readSourcesFile(backlogDir);
  const source = file.sources.find((candidate) => candidate.id === id);
  if (!source) {
    throw new Error(`Unknown source: ${id}`);
  }

  if (input.enabled !== undefined) {
    source.enabled = input.enabled;
  }
  if (input.config !== undefined) {
    source.config = input.config;
  }
  if (input.authStrategy !== undefined) {
    source.auth.strategy = input.authStrategy;
  }
  if (input.authRefs !== undefined) {
    source.auth.refs = input.authRefs;
  }
  if (input.mapping !== undefined) {
    source.mapping = input.mapping;
  }
  if (input.pull !== undefined) {
    source.sync.pull = input.pull;
  }
  if (input.pushStatus !== undefined) {
    source.sync.push_status = input.pushStatus;
  }
  if (input.pushComments !== undefined) {
    source.sync.push_comments = input.pushComments;
  }
  if (input.sourceOfTruth !== undefined) {
    source.sync.source_of_truth = input.sourceOfTruth;
  }

  writeSourcesFile(backlogDir, file);
  return source;
}

export function setSourceEnabled(backlogDir: string, id: string, enabled: boolean): SourceConfig {
  return updateSource(backlogDir, id, { enabled });
}

export function removeSource(backlogDir: string, id: string, options?: { force?: boolean }): SourceConfig {
  const file = readSourcesFile(backlogDir);
  const index = file.sources.findIndex((candidate) => candidate.id === id);
  if (index < 0) {
    throw new Error(`Unknown source: ${id}`);
  }

  const tasks = readTasksFile(backlogDir);
  const linkedTasks = tasks.tasks.filter((item) => item.source_links.some((link) => link.source_ref === id));
  if (linkedTasks.length > 0 && !options?.force) {
    throw new Error(`Source ${id} is still linked from ${linkedTasks.length} task(s). Re-run with --force.`);
  }

  if (linkedTasks.length > 0) {
    for (const item of tasks.tasks) {
      item.source_links = item.source_links.filter((link) => link.source_ref !== id);
      item.updated_at = new Date().toISOString();
    }
    writeTasksFile(backlogDir, tasks);
  }

  const [removed] = file.sources.splice(index, 1);
  if (!removed) {
    throw new Error(`Unknown source: ${id}`);
  }
  writeSourcesFile(backlogDir, file);
  return removed;
}

export function primarySourceLink(item: Task) {
  return item.source_links[0] ?? null;
}

function sourceKey(item: Task): string | null {
  const source = item.source_links[0];
  if (!source) {
    return null;
  }
  return `${source.kind}:${source.source_ref ?? "default"}:${source.external_id}`;
}

function importedKey(sourceKind: string, sourceRef: string, externalId: string): string {
  return `${sourceKind}:${sourceRef}:${externalId}`;
}

export function upsertImportedTasks(backlogDir: string, importedItems: Task[]): Task[] {
  const file = readTasksFile(backlogDir);
  const index = new Map<string, Task>();
  for (const item of file.tasks) {
    const key = sourceKey(item);
    if (key) {
      index.set(key, item);
    }
  }

  const touched: Task[] = [];
  for (const imported of importedItems) {
    const source = imported.source_links[0];
    if (!source) {
      file.tasks.push(imported);
      touched.push(imported);
      continue;
    }
    const key = importedKey(source.kind, source.source_ref ?? "default", source.external_id);
    const existing = index.get(key);
    if (!existing) {
      file.tasks.push(imported);
      touched.push(imported);
      index.set(key, imported);
      continue;
    }

    existing.title = imported.title;
    existing.description = imported.description;
    existing.priority = imported.priority;
    if (existing.status !== imported.status && source.source_ref) {
      recordStatusConflict({
        backlogDir,
        taskId: existing.id,
        sourceRef: source.source_ref,
        localValue: existing.status,
        externalValue: imported.status,
      });
    } else {
      existing.status = imported.status;
    }
    existing.labels = imported.labels;
    existing.updated_at = new Date().toISOString();
    touched.push(existing);
  }

  writeTasksFile(backlogDir, file);
  return touched;
}
