import fs from "node:fs";
import path from "node:path";
import { syncConflictsFileSchema, type SyncConflict, type SyncConflictsFile, type WorkItem } from "@cockpit-ai/schemas";
import { makeId } from "./id.js";
import { readWorkItemsFile, writeWorkItemsFile } from "./state-files.js";

function conflictsPath(cockpitDir: string): string {
  return path.join(cockpitDir, "sync-conflicts.json");
}

export function readSyncConflictsFile(cockpitDir: string): SyncConflictsFile {
  const filePath = conflictsPath(cockpitDir);
  if (!fs.existsSync(filePath)) {
    return { version: 1, conflicts: [] };
  }
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  return syncConflictsFileSchema.parse(raw);
}

export function writeSyncConflictsFile(cockpitDir: string, file: SyncConflictsFile): void {
  fs.writeFileSync(conflictsPath(cockpitDir), JSON.stringify(file, null, 2) + "\n", "utf8");
}

export function listSyncConflicts(cockpitDir: string): SyncConflict[] {
  return readSyncConflictsFile(cockpitDir).conflicts;
}

export function listPendingSyncConflicts(cockpitDir: string): SyncConflict[] {
  return listSyncConflicts(cockpitDir).filter((conflict) => conflict.resolution === "pending");
}

export function recordStatusConflict(params: {
  cockpitDir: string;
  workItemId: string;
  sourceRef: string;
  localValue: string;
  externalValue: string;
}): SyncConflict {
  const file = readSyncConflictsFile(params.cockpitDir);
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
    writeSyncConflictsFile(params.cockpitDir, file);
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
  writeSyncConflictsFile(params.cockpitDir, file);
  return conflict;
}

export function resolveSyncConflict(cockpitDir: string, conflictId: string, resolution: "external" | "local"): SyncConflict {
  const conflicts = readSyncConflictsFile(cockpitDir);
  const conflict = conflicts.conflicts.find((item) => item.id === conflictId);
  if (!conflict) {
    throw new Error(`Unknown sync conflict: ${conflictId}`);
  }
  conflict.resolution = resolution;
  conflict.resolved_at = new Date().toISOString();

  if (resolution === "external") {
    const workItems = readWorkItemsFile(cockpitDir);
    const workItem = workItems.items.find((item) => item.id === conflict.work_item_id);
    if (workItem) {
      workItem.status = conflict.external_value as WorkItem["status"];
      workItem.updated_at = new Date().toISOString();
      writeWorkItemsFile(cockpitDir, workItems);
    }
  }

  writeSyncConflictsFile(cockpitDir, conflicts);
  return conflict;
}
