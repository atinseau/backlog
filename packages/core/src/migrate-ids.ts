// `backlog migrate ids` core — rename every legacy hex/timestamp ID in
// a project to the new sequential type_NNN format (task_001,
// subtask_001, run_001, claim_001, sync_001).
//
// Strategy:
//   1. Read every state file into memory.
//   2. For each entity type, sort by created_at and assign new IDs
//      sequentially. Build a single rename map old_id → new_id.
//   3. Walk every file again and substitute references using the map.
//   4. Rename run directories on disk to match new run IDs.
//   5. Write id-counters.json reflecting the highest-assigned counter
//      so future entities continue from there.
//
// Safety:
//   - The caller is expected to have made a backup of <backlogDir>
//     before invoking this. We don't snapshot here; the CLI command
//     does the cp -R first and refuses to run a second time if the
//     backup already exists.
//   - Mixed-format projects are tolerated: an ID that already
//     matches the new format (task_NNN) is kept as-is; only legacy
//     IDs get renamed.

import fs from "node:fs";
import path from "node:path";
import {
  type Run,
  type ClaimRecord,
} from "@backlog/schemas";
import {
  formatId,
  setIdCounters,
  type IdType,
} from "@backlog/config";
import {
  readSubTasksFile,
  readTasksFile,
  writeSubTasksFile,
  writeTasksFile,
} from "./state-files.js";
import {
  readSyncConflictsFile,
  writeSyncConflictsFile,
} from "./sync-conflicts.js";
import { listAllRuns, writeRun } from "./run-store.js";

const NEW_FORMAT = /^(task|subtask|run|claim|sync)_\d{3,}$/;

export interface MigrationReport {
  task: { migrated: number; preserved: number };
  subtask: { migrated: number; preserved: number };
  run: { migrated: number; preserved: number };
  claim: { migrated: number; preserved: number };
  sync: { migrated: number; preserved: number };
  renames: Record<string, string>;
}

function emptyReport(): MigrationReport {
  return {
    task: { migrated: 0, preserved: 0 },
    subtask: { migrated: 0, preserved: 0 },
    run: { migrated: 0, preserved: 0 },
    claim: { migrated: 0, preserved: 0 },
    sync: { migrated: 0, preserved: 0 },
    renames: {},
  };
}

interface Numbering {
  counter: number;
  map: Map<string, string>;
}

function assign(
  type: IdType,
  entities: Array<{ id: string; created_at?: string }>,
  report: MigrationReport,
): Numbering {
  const map = new Map<string, string>();
  // Sort legacy entries by created_at so the new sequential IDs reflect
  // creation order. Already-new entries keep their explicit number.
  const legacy = entities.filter((e) => !NEW_FORMAT.test(e.id));
  const fresh = entities.filter((e) => NEW_FORMAT.test(e.id));
  legacy.sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));

  let counter = 0;
  // Preserve any existing new-format entries — extract their counters
  // so we don't reuse them for legacy items.
  const usedNumbers = new Set<number>();
  for (const e of fresh) {
    const m = e.id.match(/_(\d+)$/);
    if (m) {
      const n = parseInt(m[1]!, 10);
      usedNumbers.add(n);
      counter = Math.max(counter, n);
    }
    report[type].preserved += 1;
  }
  for (const e of legacy) {
    do {
      counter += 1;
    } while (usedNumbers.has(counter));
    const next = formatId(type, counter);
    map.set(e.id, next);
    report.renames[e.id] = next;
    report[type].migrated += 1;
  }
  return { counter, map };
}

function rewriteIdField<T extends { id: string }>(item: T, map: Map<string, string>): void {
  const next = map.get(item.id);
  if (next) item.id = next;
}

function rewriteRef(value: string | undefined, map: Map<string, string>): string | undefined {
  if (!value) return value;
  return map.get(value) ?? value;
}

function rewriteRefs(arr: string[] | undefined, map: Map<string, string>): string[] | undefined {
  if (!arr) return arr;
  return arr.map((v) => map.get(v) ?? v);
}

export async function migrateProjectIds(backlogDir: string): Promise<MigrationReport> {
  const report = emptyReport();

  // ---- Load all state ----
  const tasksFile = readTasksFile(backlogDir);
  const subtasksFile = readSubTasksFile(backlogDir);
  const conflictsFile = readSyncConflictsFile(backlogDir);
  const runs = listAllRuns(backlogDir);

  const claimsActiveDir = path.join(backlogDir, "claims", "active");
  const claimsArchiveDir = path.join(backlogDir, "claims", "archive");
  const claimEntries: Array<{ filePath: string; claim: ClaimRecord }> = [];
  for (const dir of [claimsActiveDir, claimsArchiveDir]) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".json")) continue;
      const filePath = path.join(dir, name);
      const claim = JSON.parse(fs.readFileSync(filePath, "utf8")) as ClaimRecord;
      claimEntries.push({ filePath, claim });
    }
  }

  // ---- Build rename maps ----
  const taskNum = assign("task", tasksFile.tasks, report);
  const subtaskNum = assign("subtask", subtasksFile.subtasks, report);
  const runNum = assign(
    "run",
    runs.map((r) => ({ id: r.id, created_at: r.started_at ?? "" })),
    report,
  );
  const claimNum = assign(
    "claim",
    claimEntries.map((c) => ({ id: c.claim.id, created_at: c.claim.created_at })),
    report,
  );
  const syncNum = assign(
    "sync",
    conflictsFile.conflicts.map((c) => ({ id: c.id, created_at: c.detected_at })),
    report,
  );

  // ---- Rewrite ----
  // Tasks: id only.
  for (const t of tasksFile.tasks) rewriteIdField(t, taskNum.map);

  // SubTasks: id + task_id.
  for (const st of subtasksFile.subtasks) {
    rewriteIdField(st, subtaskNum.map);
    st.task_id = rewriteRef(st.task_id, taskNum.map) ?? st.task_id;
    st.depends_on = rewriteRefs(st.depends_on, subtaskNum.map) ?? st.depends_on;
  }

  // Sync conflicts: id + task_id (it points at a Task in the new schema).
  for (const c of conflictsFile.conflicts) {
    rewriteIdField(c, syncNum.map);
    c.task_id = rewriteRef(c.task_id, taskNum.map) ?? c.task_id;
  }

  // Claims: id only (claims don't reference tasks/subtasks by id directly
  // in the schema — the link goes the other way, via Run.claim_ids).
  for (const { claim } of claimEntries) rewriteIdField(claim, claimNum.map);

  // Runs: id + task_id + subtask_id + claim_ids[].
  const runsRenamed: Run[] = [];
  for (const r of runs) {
    const oldId = r.id;
    rewriteIdField(r, runNum.map);
    r.task_id = rewriteRef(r.task_id, taskNum.map) ?? r.task_id;
    if (r.subtask_id) r.subtask_id = rewriteRef(r.subtask_id, subtaskNum.map) ?? r.subtask_id;
    if (r.target_type === "task" && r.target_id) r.target_id = rewriteRef(r.target_id, taskNum.map) ?? r.target_id;
    if ((r.target_type ?? "subtask") === "subtask" && r.target_id) r.target_id = rewriteRef(r.target_id, subtaskNum.map) ?? r.target_id;
    r.claim_ids = (r.claim_ids ?? []).map((id) => claimNum.map.get(id) ?? id);
    runsRenamed.push(r);
    // Run directories on disk are named after the run id — rename them.
    if (oldId !== r.id) {
      for (const base of ["active", "archive"]) {
        const oldDir = path.join(backlogDir, "runs", base, oldId);
        const newDir = path.join(backlogDir, "runs", base, r.id);
        if (fs.existsSync(oldDir) && !fs.existsSync(newDir)) {
          fs.renameSync(oldDir, newDir);
        }
      }
    }
  }

  // ---- Persist ----
  writeTasksFile(backlogDir, tasksFile);
  writeSubTasksFile(backlogDir, subtasksFile);
  writeSyncConflictsFile(backlogDir, conflictsFile);
  for (const { filePath, claim } of claimEntries) {
    fs.writeFileSync(filePath, `${JSON.stringify(claim, null, 2)}\n`, "utf8");
  }
  for (const r of runsRenamed) writeRun(backlogDir, r);

  // ---- Counter file ----
  setIdCounters(backlogDir, {
    task: taskNum.counter,
    subtask: subtaskNum.counter,
    run: runNum.counter,
    claim: claimNum.counter,
    sync: syncNum.counter,
  });

  return report;
}
