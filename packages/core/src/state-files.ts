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
