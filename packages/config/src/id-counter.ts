// Per-project sequential ID generator.
//
// Replaces the old `makeId(prefix)` (which produced `TASK-c4bdf6ac` style)
// with `nextId(backlogDir, type)` returning `task_001`, `task_002`, …
//
// The counter file lives at `<backlogDir>/id-counters.json` and is
// updated synchronously on every call. Atomic across a single Node
// process; cross-process safety is left to higher-level coordination
// (the daemon docs already warn against running concurrent backlog
// commands on the same workspace).
//
// New entity types append to `IdType` and the default counters map
// below — the module is otherwise type-agnostic.

import fs from "node:fs";
import path from "node:path";

export type IdType = "task" | "subtask" | "run" | "claim" | "sync" | "conv";

interface IdCountersFile {
  version: 1;
  counters: Record<IdType, number>;
}

function defaultCounters(): IdCountersFile {
  return {
    version: 1,
    counters: { task: 0, subtask: 0, run: 0, claim: 0, sync: 0, conv: 0 },
  };
}

function countersPath(backlogDir: string): string {
  return path.join(backlogDir, "id-counters.json");
}

function readCounters(backlogDir: string): IdCountersFile {
  const file = countersPath(backlogDir);
  if (!fs.existsSync(file)) return defaultCounters();
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<IdCountersFile>;
    const fresh = defaultCounters();
    return {
      version: 1,
      counters: { ...fresh.counters, ...(raw.counters ?? {}) },
    };
  } catch {
    return defaultCounters();
  }
}

function writeCounters(backlogDir: string, file: IdCountersFile): void {
  fs.mkdirSync(backlogDir, { recursive: true });
  fs.writeFileSync(countersPath(backlogDir), `${JSON.stringify(file, null, 2)}\n`, "utf8");
}

function format(type: IdType, n: number): string {
  return `${type}_${n.toString().padStart(3, "0")}`;
}

// Increment the counter for `type` and return the next id.
export function nextId(backlogDir: string, type: IdType): string {
  const file = readCounters(backlogDir);
  const next = (file.counters[type] ?? 0) + 1;
  file.counters[type] = next;
  writeCounters(backlogDir, file);
  return format(type, next);
}

// Read-only snapshot for the migration tool (which needs to know
// where to start re-attributing existing IDs).
export function readIdCounters(backlogDir: string): Record<IdType, number> {
  return { ...readCounters(backlogDir).counters };
}

// Used by the migration tool after re-attributing every ID, so the
// counters resume from the highest assigned number.
export function setIdCounters(backlogDir: string, counters: Partial<Record<IdType, number>>): void {
  const file = readCounters(backlogDir);
  for (const [k, v] of Object.entries(counters)) {
    if (typeof v === "number") file.counters[k as IdType] = v;
  }
  writeCounters(backlogDir, file);
}

// Format helper exposed for the migration tool.
export function formatId(type: IdType, n: number): string {
  return format(type, n);
}

// Regex matching the new format. Three or more digits to allow growth
// past 999. Used by the parser in `server/src/routes/commits.ts`.
export const ID_REGEX: Record<IdType, RegExp> = {
  task: /\btask_\d{3,}\b/g,
  subtask: /\bsubtask_\d{3,}\b/g,
  run: /\brun_\d{3,}\b/g,
  claim: /\bclaim_\d{3,}\b/g,
  sync: /\bsync_\d{3,}\b/g,
  conv: /\bconv_\d{3,}\b/g,
};
