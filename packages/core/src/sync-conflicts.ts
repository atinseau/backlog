import fs from "node:fs";
import path from "node:path";
import { syncConflictsFileSchema, type SyncConflict, type SyncConflictsFile, type WorkItem } from "@backlog/schemas";
import { makeId } from "./id.js";
import { readWorkItemsFile, writeWorkItemsFile } from "./state-files.js";

function conflictsPath(backlogDir: string): string {
  return path.join(backlogDir, "sync-conflicts.json");
}

export function readSyncConflictsFile(backlogDir: string): SyncConflictsFile {
  const filePath = conflictsPath(backlogDir);
  if (!fs.existsSync(filePath)) {
    return { version: 1, conflicts: [] };
  }
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  return syncConflictsFileSchema.parse(raw);
}

export function writeSyncConflictsFile(backlogDir: string, file: SyncConflictsFile): void {
  fs.writeFileSync(conflictsPath(backlogDir), JSON.stringify(file, null, 2) + "\n", "utf8");
}

export function listSyncConflicts(backlogDir: string): SyncConflict[] {
  return readSyncConflictsFile(backlogDir).conflicts;
}

export function listPendingSyncConflicts(backlogDir: string): SyncConflict[] {
  return listSyncConflicts(backlogDir).filter((conflict) => conflict.resolution === "pending");
}

export function listPendingSyncConflictsForWorkItem(backlogDir: string, workItemId: string): SyncConflict[] {
  return listPendingSyncConflicts(backlogDir).filter((conflict) => conflict.work_item_id === workItemId);
}

export function hasPendingSyncConflictsForWorkItem(backlogDir: string, workItemId: string): boolean {
  return listPendingSyncConflictsForWorkItem(backlogDir, workItemId).length > 0;
}

export function recordStatusConflict(params: {
  backlogDir: string;
  workItemId: string;
  sourceRef: string;
  localValue: string;
  externalValue: string;
}): SyncConflict {
  const file = readSyncConflictsFile(params.backlogDir);
  const existing = file.conflicts.find((conflict) =>
    conflict.work_item_id === params.workItemId &&
    conflict.source_ref === params.sourceRef &&
    conflict.field === "status" &&
    conflict.resolution === "pending",
  );

  if (existing) {
    existing.local_value = params.localValue;
    existing.external_value = params.externalValue;
    existing.detected_at = new Date().toISOString();
    writeSyncConflictsFile(params.backlogDir, file);
    return existing;
  }

  const conflict: SyncConflict = {
    id: makeId("SYNC"),
    work_item_id: params.workItemId,
    source_ref: params.sourceRef,
    field: "status",
    local_value: params.localValue,
    external_value: params.externalValue,
    resolution: "pending",
    detected_at: new Date().toISOString(),
  };
  file.conflicts.push(conflict);
  writeSyncConflictsFile(params.backlogDir, file);
  return conflict;
}

export function resolveSyncConflict(backlogDir: string, conflictId: string, resolution: "external" | "local"): SyncConflict {
  const conflicts = readSyncConflictsFile(backlogDir);
  const conflict = conflicts.conflicts.find((item) => item.id === conflictId);
  if (!conflict) {
    throw new Error(`Unknown sync conflict: ${conflictId}`);
  }
  conflict.resolution = resolution;
  conflict.resolved_at = new Date().toISOString();

  if (resolution === "external") {
    const workItems = readWorkItemsFile(backlogDir);
    const workItem = workItems.items.find((item) => item.id === conflict.work_item_id);
    if (workItem) {
      workItem.status = conflict.external_value as WorkItem["status"];
      workItem.updated_at = new Date().toISOString();
      writeWorkItemsFile(backlogDir, workItems);
    }
  }

  writeSyncConflictsFile(backlogDir, conflicts);
  return conflict;
}

export function resolveSyncConflictsForWorkItem(
  backlogDir: string,
  workItemId: string,
  resolution: "external" | "local",
): SyncConflict[] {
  const pending = listPendingSyncConflictsForWorkItem(backlogDir, workItemId);
  return pending.map((conflict) => resolveSyncConflict(backlogDir, conflict.id, resolution));
}

export function removeSyncConflictsForWorkItem(backlogDir: string, workItemId: string): number {
  const file = readSyncConflictsFile(backlogDir);
  const before = file.conflicts.length;
  file.conflicts = file.conflicts.filter((conflict) => conflict.work_item_id !== workItemId);
  writeSyncConflictsFile(backlogDir, file);
  return before - file.conflicts.length;
}
