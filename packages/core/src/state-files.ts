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
  type WorkItem,
  workItemsFileSchema,
  type WorkItemsFile,
} from "@backlog/schemas";

function readYaml<T>(filePath: string, parser: (value: unknown) => T): T {
  const raw = YAML.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  return parser(raw);
}

function writeYaml(filePath: string, value: object): void {
  fs.writeFileSync(filePath, YAML.stringify(value), "utf8");
}

export function workItemsPath(backlogDir: string): string {
  return path.join(backlogDir, "work-items.yaml");
}

export function subTasksPath(backlogDir: string): string {
  return path.join(backlogDir, "subtasks.yaml");
}

const LEGACY_SUBTASKS_FILE = "tasks.yaml";

// Legacy state used .backlog/tasks.yaml with inner key `tasks: []`. The new
// shape lives at subtasks.yaml with inner key `subtasks: []`. Migrate on
// first read so older workspaces stay loadable without a manual step.
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

export function readWorkItemsFile(backlogDir: string): WorkItemsFile {
  return readYaml(workItemsPath(backlogDir), (value) => workItemsFileSchema.parse(value));
}

export function writeWorkItemsFile(backlogDir: string, file: WorkItemsFile): void {
  writeYaml(workItemsPath(backlogDir), file);
}

export function readSubTasksFile(backlogDir: string): SubTasksFile {
  migrateLegacySubTasksFile(backlogDir);
  return readYaml(subTasksPath(backlogDir), (value) => subTasksFileSchema.parse(value));
}

export function writeSubTasksFile(backlogDir: string, file: SubTasksFile): void {
  writeYaml(subTasksPath(backlogDir), file);
}

export function listWorkItems(backlogDir: string): WorkItem[] {
  return readWorkItemsFile(backlogDir).items;
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
