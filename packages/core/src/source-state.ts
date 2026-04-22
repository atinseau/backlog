import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { sourcesFileSchema, type SourceConfig, type SourcesFile, type WorkItem } from "@cockpit-ai/schemas";
import { readWorkItemsFile, writeWorkItemsFile } from "./state-files.js";
import { recordStatusConflict } from "./sync-conflicts.js";

function sourcesPath(cockpitDir: string): string {
  return path.join(cockpitDir, "sources.yaml");
}

export function readSourcesFile(cockpitDir: string): SourcesFile {
  const parsed = YAML.parse(fs.readFileSync(sourcesPath(cockpitDir), "utf8")) as unknown;
  return sourcesFileSchema.parse(parsed);
}

export function writeSourcesFile(cockpitDir: string, file: SourcesFile): void {
  fs.writeFileSync(sourcesPath(cockpitDir), YAML.stringify(file), "utf8");
}

export function listSources(cockpitDir: string): SourceConfig[] {
  return readSourcesFile(cockpitDir).sources;
}

export function addSource(cockpitDir: string, source: SourceConfig): SourceConfig {
  const file = readSourcesFile(cockpitDir);
  if (file.sources.some((candidate) => candidate.id === source.id)) {
    throw new Error(`Source already exists: ${source.id}`);
  }
  file.sources.push(source);
  writeSourcesFile(cockpitDir, file);
  return source;
}

export function getSource(cockpitDir: string, id: string): SourceConfig | null {
  return listSources(cockpitDir).find((source) => source.id === id) ?? null;
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
  sourceOfTruth?: "external" | "cockpit";
}

export function updateSource(cockpitDir: string, id: string, input: UpdateSourceInput): SourceConfig {
  const file = readSourcesFile(cockpitDir);
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

  writeSourcesFile(cockpitDir, file);
  return source;
}

export function setSourceEnabled(cockpitDir: string, id: string, enabled: boolean): SourceConfig {
  return updateSource(cockpitDir, id, { enabled });
}

export function removeSource(cockpitDir: string, id: string, options?: { force?: boolean }): SourceConfig {
  const file = readSourcesFile(cockpitDir);
  const index = file.sources.findIndex((candidate) => candidate.id === id);
  if (index < 0) {
    throw new Error(`Unknown source: ${id}`);
  }

  const workItems = readWorkItemsFile(cockpitDir);
  const linkedWorkItems = workItems.items.filter((item) => item.source_links.some((link) => link.source_ref === id));
  if (linkedWorkItems.length > 0 && !options?.force) {
    throw new Error(`Source ${id} is still linked from ${linkedWorkItems.length} work item(s). Re-run with --force.`);
  }

  if (linkedWorkItems.length > 0) {
    for (const item of workItems.items) {
      item.source_links = item.source_links.filter((link) => link.source_ref !== id);
      item.updated_at = new Date().toISOString();
    }
    writeWorkItemsFile(cockpitDir, workItems);
  }

  const [removed] = file.sources.splice(index, 1);
  if (!removed) {
    throw new Error(`Unknown source: ${id}`);
  }
  writeSourcesFile(cockpitDir, file);
  return removed;
}

export function primarySourceLink(item: WorkItem) {
  return item.source_links[0] ?? null;
}

function sourceKey(item: WorkItem): string | null {
  const source = item.source_links[0];
  if (!source) {
    return null;
  }
  return `${source.kind}:${source.source_ref ?? "default"}:${source.external_id}`;
}

function importedKey(sourceKind: string, sourceRef: string, externalId: string): string {
  return `${sourceKind}:${sourceRef}:${externalId}`;
}

export function upsertImportedWorkItems(cockpitDir: string, importedItems: WorkItem[]): WorkItem[] {
  const file = readWorkItemsFile(cockpitDir);
  const index = new Map<string, WorkItem>();
  for (const item of file.items) {
    const key = sourceKey(item);
    if (key) {
      index.set(key, item);
    }
  }

  const touched: WorkItem[] = [];
  for (const imported of importedItems) {
    const source = imported.source_links[0];
    if (!source) {
      file.items.push(imported);
      touched.push(imported);
      continue;
    }
    const key = importedKey(source.kind, source.source_ref ?? "default", source.external_id);
    const existing = index.get(key);
    if (!existing) {
      file.items.push(imported);
      touched.push(imported);
      index.set(key, imported);
      continue;
    }

    existing.title = imported.title;
    existing.description = imported.description;
    existing.priority = imported.priority;
    if (existing.status !== imported.status && source.source_ref) {
      recordStatusConflict({
        cockpitDir,
        workItemId: existing.id,
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

  writeWorkItemsFile(cockpitDir, file);
  return touched;
}
