import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import {
  tasksFileSchema,
  type Task,
  type TasksFile,
  type WorkItem,
  workItemsFileSchema,
  type WorkItemsFile,
} from "@cockpit-ai/schemas";

function readYaml<T>(filePath: string, parser: (value: unknown) => T): T {
  const raw = YAML.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  return parser(raw);
}

function writeYaml(filePath: string, value: object): void {
  fs.writeFileSync(filePath, YAML.stringify(value), "utf8");
}

export function workItemsPath(cockpitDir: string): string {
  return path.join(cockpitDir, "work-items.yaml");
}

export function tasksPath(cockpitDir: string): string {
  return path.join(cockpitDir, "tasks.yaml");
}

export function readWorkItemsFile(cockpitDir: string): WorkItemsFile {
  return readYaml(workItemsPath(cockpitDir), (value) => workItemsFileSchema.parse(value));
}

export function writeWorkItemsFile(cockpitDir: string, file: WorkItemsFile): void {
  writeYaml(workItemsPath(cockpitDir), file);
}

export function readTasksFile(cockpitDir: string): TasksFile {
  return readYaml(tasksPath(cockpitDir), (value) => tasksFileSchema.parse(value));
}

export function writeTasksFile(cockpitDir: string, file: TasksFile): void {
  writeYaml(tasksPath(cockpitDir), file);
}

export function listWorkItems(cockpitDir: string): WorkItem[] {
  return readWorkItemsFile(cockpitDir).items;
}

export function listTasks(cockpitDir: string): Task[] {
  return readTasksFile(cockpitDir).tasks;
}
