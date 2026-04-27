import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import {
  defaultOrchestratorState,
  type OrchestratorState,
  orchestratorStateSchema,
  subTasksFileSchema,
  type SubTask,
  type SubTasksFile,
  type Task,
  tasksFileSchema,
  type TasksFile,
} from "@backlog/schemas";

function readYaml<T>(filePath: string, parser: (value: unknown) => T): T {
  const raw = YAML.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  return parser(raw);
}

function writeYaml(filePath: string, value: object): void {
  fs.writeFileSync(filePath, YAML.stringify(value), "utf8");
}

export function tasksPath(backlogDir: string): string {
  return path.join(backlogDir, "tasks.yaml");
}

export function subTasksPath(backlogDir: string): string {
  return path.join(backlogDir, "subtasks.yaml");
}

const LEGACY_SUBTASKS_FILE = "tasks.yaml";
const LEGACY_TASKS_FILE = "work-items.yaml";

// Legacy state used .backlog/tasks.yaml with inner key `tasks: []` for the
// per-repo execution units. The new shape lives at subtasks.yaml with inner
// key `subtasks: []`. Migrate on first read.
function migrateLegacySubTasksFile(backlogDir: string): void {
  const newPath = subTasksPath(backlogDir);
  const oldPath = path.join(backlogDir, LEGACY_SUBTASKS_FILE);
  if (!fs.existsSync(oldPath) || fs.existsSync(newPath)) return;
  const raw = YAML.parse(fs.readFileSync(oldPath, "utf8")) as Record<string, unknown>;
  if ("tasks" in raw && !("subtasks" in raw)) {
    raw.subtasks = raw.tasks;
    delete raw.tasks;
  }
  fs.writeFileSync(newPath, YAML.stringify(raw), "utf8");
  fs.unlinkSync(oldPath);
}

// Per-row migration: the SubTask schema's parent FK was historically named
// work_item_id (back when the parent was a WorkItem). It's now task_id.
// We rewrite each row in-place on read so existing .backlog/subtasks.yaml
// files keep working without manual editing.
function migrateSubTaskRows(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const obj = raw as Record<string, unknown>;
  const subtasks = obj.subtasks;
  if (!Array.isArray(subtasks)) return obj;
  let dirty = false;
  for (const row of subtasks) {
    if (row && typeof row === "object") {
      const r = row as Record<string, unknown>;
      if ("work_item_id" in r && !("task_id" in r)) {
        r["task_id"] = r["work_item_id"];
        delete r["work_item_id"];
        dirty = true;
      }
    }
  }
  if (dirty) obj.subtasks = subtasks;
  return obj;
}

// Legacy state used .backlog/work-items.yaml with inner key `items: []` for
// the kanban cards. The new shape is .backlog/tasks.yaml with inner key
// `tasks: []`. Migrate on first read.
function migrateLegacyTasksFile(backlogDir: string): void {
  // Run sub-tasks migration first so the destination tasks.yaml in the legacy
  // tree is moved out of the way before we use that filename for kanban cards.
  migrateLegacySubTasksFile(backlogDir);
  const newPath = tasksPath(backlogDir);
  const oldPath = path.join(backlogDir, LEGACY_TASKS_FILE);
  if (!fs.existsSync(oldPath) || fs.existsSync(newPath)) return;
  const raw = YAML.parse(fs.readFileSync(oldPath, "utf8")) as Record<string, unknown>;
  if ("items" in raw && !("tasks" in raw)) {
    raw.tasks = raw.items;
    delete raw.items;
  }
  fs.writeFileSync(newPath, YAML.stringify(raw), "utf8");
  fs.unlinkSync(oldPath);
}

export function readTasksFile(backlogDir: string): TasksFile {
  migrateLegacyTasksFile(backlogDir);
  return readYaml(tasksPath(backlogDir), (value) => tasksFileSchema.parse(value));
}

export function writeTasksFile(backlogDir: string, file: TasksFile): void {
  writeYaml(tasksPath(backlogDir), file);
}

export function readSubTasksFile(backlogDir: string): SubTasksFile {
  migrateLegacySubTasksFile(backlogDir);
  const filePath = subTasksPath(backlogDir);
  const raw = YAML.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  const before = JSON.stringify(raw);
  const migrated = migrateSubTaskRows(raw);
  const parsed = subTasksFileSchema.parse(migrated);
  // If migration changed the on-disk shape, persist it once so we stop
  // re-doing the work on every read.
  if (JSON.stringify(migrated) !== before) {
    fs.writeFileSync(filePath, YAML.stringify(parsed), "utf8");
  }
  return parsed;
}

export function writeSubTasksFile(backlogDir: string, file: SubTasksFile): void {
  writeYaml(subTasksPath(backlogDir), file);
}

export function listTasks(backlogDir: string): Task[] {
  return readTasksFile(backlogDir).tasks;
}

export function listSubTasks(backlogDir: string): SubTask[] {
  return readSubTasksFile(backlogDir).subtasks;
}

export function orchestratorStatePath(backlogDir: string): string {
  return path.join(backlogDir, "orchestrator.json");
}

export function readOrchestratorState(backlogDir: string): OrchestratorState {
  const filePath = orchestratorStatePath(backlogDir);
  if (!fs.existsSync(filePath)) {
    return defaultOrchestratorState();
  }
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  return orchestratorStateSchema.parse(raw);
}

export function writeOrchestratorState(backlogDir: string, state: OrchestratorState): void {
  const filePath = orchestratorStatePath(backlogDir);
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), "utf8");
  fs.renameSync(tmpPath, filePath);
}
