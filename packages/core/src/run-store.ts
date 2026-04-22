import fs from "node:fs";
import path from "node:path";
import { runSchema, type Artifact, type Run, type Task, type WorkItem } from "@cockpit-ai/schemas";
import type { Agent } from "@cockpit-ai/schemas";
import { makeId } from "./id.js";

function activeRunsDir(cockpitDir: string): string {
  return path.join(cockpitDir, "runs", "active");
}

function archiveRunsDir(cockpitDir: string): string {
  return path.join(cockpitDir, "runs", "archive");
}

function runDirectory(baseDir: string, runId: string): string {
  return path.join(baseDir, runId);
}

export function nextRunId(): string {
  return makeId("RUN");
}

export function createRun(params: {
  cockpitDir: string;
  runId: string;
  task: Task;
  workItem: WorkItem;
  agent: Agent;
  branch: string;
  worktreePath: string;
  claimIds: string[];
}): Run {
  const directory = runDirectory(activeRunsDir(params.cockpitDir), params.runId);
  fs.mkdirSync(directory, { recursive: true });

  const run: Run = {
    version: 1,
    id: params.runId,
    task_id: params.task.id,
    work_item_id: params.workItem.id,
    repo: params.task.repo,
    branch: params.branch,
    agent_id: params.agent.id,
    provider: params.agent.provider,
    status: "preparing",
    claim_ids: params.claimIds,
    worktree_path: params.worktreePath,
    artifacts: [],
    result: null,
    started_at: new Date().toISOString(),
  };

  writeRun(params.cockpitDir, run);
  appendRunEvent(params.cockpitDir, run.id, {
    ts: new Date().toISOString(),
    type: "run.created",
    message: `Created run ${run.id}`,
  });
  return run;
}

export function writeRun(cockpitDir: string, run: Run): void {
  const directory = runDirectory(activeRunsDir(cockpitDir), run.id);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "run.json"), JSON.stringify(runSchema.parse(run), null, 2) + "\n", "utf8");
}

export function appendRunEvent(cockpitDir: string, runId: string, event: Record<string, string>): void {
  const eventsPath = path.join(runDirectory(activeRunsDir(cockpitDir), runId), "events.ndjson");
  fs.appendFileSync(eventsPath, JSON.stringify(event) + "\n", "utf8");
}

export function listActiveRuns(cockpitDir: string): Run[] {
  const directory = activeRunsDir(cockpitDir);
  if (!fs.existsSync(directory)) {
    return [];
  }
  return fs.readdirSync(directory)
    .filter((entry) => fs.existsSync(path.join(directory, entry, "run.json")))
    .map((entry) => {
      const raw = JSON.parse(fs.readFileSync(path.join(directory, entry, "run.json"), "utf8")) as unknown;
      return runSchema.parse(raw);
    });
}

export function getRunEvents(cockpitDir: string, runId: string): string[] {
  const activeEventsPath = path.join(activeRunsDir(cockpitDir), runId, "events.ndjson");
  const archiveEventsPath = path.join(archiveRunsDir(cockpitDir), runId, "events.ndjson");
  const target = fs.existsSync(activeEventsPath) ? activeEventsPath : archiveEventsPath;
  if (!fs.existsSync(target)) {
    return [];
  }
  return fs.readFileSync(target, "utf8").split("\n").filter(Boolean);
}

export function loadRun(cockpitDir: string, runId: string): Run | null {
  const activePath = path.join(activeRunsDir(cockpitDir), runId, "run.json");
  const archivePath = path.join(archiveRunsDir(cockpitDir), runId, "run.json");
  const target = fs.existsSync(activePath) ? activePath : archivePath;
  if (!fs.existsSync(target)) {
    return null;
  }
  return runSchema.parse(JSON.parse(fs.readFileSync(target, "utf8")) as unknown);
}

export function updateRunStatus(cockpitDir: string, runId: string, status: Run["status"], result?: string): Run {
  const current = loadRun(cockpitDir, runId);
  if (!current) {
    throw new Error(`Unknown run: ${runId}`);
  }
  const next: Run = {
    ...current,
    status,
    ...(result !== undefined ? { result } : {}),
    ...(status === "succeeded" || status === "failed" || status === "blocked" || status === "interrupted" || status === "canceled"
      ? { finished_at: new Date().toISOString() }
      : {}),
  };
  writeRun(cockpitDir, next);
  appendRunEvent(cockpitDir, runId, {
    ts: new Date().toISOString(),
    type: "run.status",
    message: `Run moved to ${status}`,
  });
  return next;
}

export function addRunArtifact(cockpitDir: string, runId: string, artifact: Artifact): Run {
  const current = loadRun(cockpitDir, runId);
  if (!current) {
    throw new Error(`Unknown run: ${runId}`);
  }
  const next = {
    ...current,
    artifacts: [...current.artifacts, artifact],
  };
  writeRun(cockpitDir, next);
  return next;
}
