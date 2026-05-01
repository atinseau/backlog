import fs from "node:fs";
import path from "node:path";
import { syncConflictsFileSchema, type SyncConflict, type SyncConflictsFile, type Task } from "@backlog/schemas";
import { nextId } from "@backlog/config";
import { readTasksFile, writeTasksFile } from "./state-files.js";

function conflictsPath(backlogDir: string): string {
  return path.join(backlogDir, "sync-conflicts.json");
}

const LEGACY_PARENT_FIELD = "work" + "_item_id";

export function readSyncConflictsFile(backlogDir: string): SyncConflictsFile {
  const filePath = conflictsPath(backlogDir);
  if (!fs.existsSync(filePath)) {
    return { version: 1, conflicts: [] };
  }
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  // Per-row migration from the pre-task parent field to task_id.
  if (raw && typeof raw === "object") {
    const conflicts = (raw as { conflicts?: unknown[] }).conflicts;
    if (Array.isArray(conflicts)) {
      for (const row of conflicts) {
        if (row && typeof row === "object") {
          const r = row as Record<string, unknown>;
          if (LEGACY_PARENT_FIELD in r && !("task_id" in r)) {
            r["task_id"] = r[LEGACY_PARENT_FIELD];
            delete r[LEGACY_PARENT_FIELD];
          }
        }
      }
    }
  }
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

export function listPendingSyncConflictsForTask(backlogDir: string, taskId: string): SyncConflict[] {
  return listPendingSyncConflicts(backlogDir).filter((conflict) => conflict.task_id === taskId);
}

export function hasPendingSyncConflictsForTask(backlogDir: string, taskId: string): boolean {
  return listPendingSyncConflictsForTask(backlogDir, taskId).length > 0;
}

export function recordStatusConflict(params: {
  backlogDir: string;
  taskId: string;
  sourceRef: string;
  localValue: string;
  externalValue: string;
}): SyncConflict {
  const file = readSyncConflictsFile(params.backlogDir);
  const existing = file.conflicts.find((conflict) =>
    conflict.task_id === params.taskId &&
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
    id: nextId(params.backlogDir, "sync"),
    task_id: params.taskId,
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
    const tasks = readTasksFile(backlogDir);
    const task = tasks.tasks.find((item) => item.id === conflict.task_id);
    if (task) {
      task.status = conflict.external_value as Task["status"];
      task.updated_at = new Date().toISOString();
      writeTasksFile(backlogDir, tasks);
    }
  }

  writeSyncConflictsFile(backlogDir, conflicts);
  return conflict;
}

export function resolveSyncConflictsForTask(
  backlogDir: string,
  taskId: string,
  resolution: "external" | "local",
): SyncConflict[] {
  const pending = listPendingSyncConflictsForTask(backlogDir, taskId);
  return pending.map((conflict) => resolveSyncConflict(backlogDir, conflict.id, resolution));
}

export function removeSyncConflictsForTask(backlogDir: string, taskId: string): number {
  const file = readSyncConflictsFile(backlogDir);
  const before = file.conflicts.length;
  file.conflicts = file.conflicts.filter((conflict) => conflict.task_id !== taskId);
  writeSyncConflictsFile(backlogDir, file);
  return before - file.conflicts.length;
}
