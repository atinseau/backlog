import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import {
  defaultOrchestratorState,
  type OrchestratorState,
  orchestratorStateSchema,
  tasksFileSchema,
  type Task,
  type TasksFile,
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

export function tasksPath(backlogDir: string): string {
  return path.join(backlogDir, "tasks.yaml");
}

export function readWorkItemsFile(backlogDir: string): WorkItemsFile {
  return readYaml(workItemsPath(backlogDir), (value) => workItemsFileSchema.parse(value));
}

export function writeWorkItemsFile(backlogDir: string, file: WorkItemsFile): void {
  writeYaml(workItemsPath(backlogDir), file);
}

export function readTasksFile(backlogDir: string): TasksFile {
  return readYaml(tasksPath(backlogDir), (value) => tasksFileSchema.parse(value));
}

export function writeTasksFile(backlogDir: string, file: TasksFile): void {
  writeYaml(tasksPath(backlogDir), file);
}

export function listWorkItems(backlogDir: string): WorkItem[] {
  return readWorkItemsFile(backlogDir).items;
}

export function listTasks(backlogDir: string): Task[] {
  return readTasksFile(backlogDir).tasks;
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
