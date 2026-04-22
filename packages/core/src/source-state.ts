import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { sourcesFileSchema, type SourceConfig, type SourcesFile, type WorkItem } from "@cockpit-ai/schemas";
import { readWorkItemsFile, writeWorkItemsFile } from "./state-files.js";

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
    existing.status = imported.status;
    existing.labels = imported.labels;
    existing.updated_at = new Date().toISOString();
    touched.push(existing);
  }

  writeWorkItemsFile(cockpitDir, file);
  return touched;
}
