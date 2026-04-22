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
  const activePath = path.join(runDirectory(activeRunsDir(cockpitDir), runId), "events.ndjson");
  const archivePath = path.join(runDirectory(archiveRunsDir(cockpitDir), runId), "events.ndjson");
  const eventsPath = fs.existsSync(path.dirname(activePath)) ? activePath : archivePath;
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
    })
    .filter((run) => !isTerminalRunStatus(run.status));
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

export function isTerminalRunStatus(status: Run["status"]): boolean {
  return status === "succeeded" || status === "failed" || status === "blocked" || status === "canceled";
}

export function listAllRuns(cockpitDir: string): Run[] {
  const directories = [
    activeRunsDir(cockpitDir),
    archiveRunsDir(cockpitDir),
  ];
  const seen = new Set<string>();
  const runs: Run[] = [];
  for (const directory of directories) {
    if (!fs.existsSync(directory)) {
      continue;
    }
    for (const entry of fs.readdirSync(directory)) {
      if (seen.has(entry)) {
        continue;
      }
      const filePath = path.join(directory, entry, "run.json");
      if (!fs.existsSync(filePath)) {
        continue;
      }
      const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
      runs.push(runSchema.parse(raw));
      seen.add(entry);
    }
  }
  return runs;
}

export function listArchivedRuns(cockpitDir: string): Run[] {
  const directory = archiveRunsDir(cockpitDir);
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

export function archiveRun(cockpitDir: string, runId: string): Run {
  const run = loadRun(cockpitDir, runId);
  if (!run) {
    throw new Error(`Unknown run: ${runId}`);
  }
  const activeDir = runDirectory(activeRunsDir(cockpitDir), runId);
  const archiveDir = runDirectory(archiveRunsDir(cockpitDir), runId);
  if (!fs.existsSync(activeDir)) {
    return run;
  }
  fs.mkdirSync(path.dirname(archiveDir), { recursive: true });
  fs.rmSync(archiveDir, { recursive: true, force: true });
  fs.renameSync(activeDir, archiveDir);
  return run;
}

export interface RunGcResult {
  removed: string[];
}

export function garbageCollectArchivedRuns(cockpitDir: string): RunGcResult {
  const directory = archiveRunsDir(cockpitDir);
  const result: RunGcResult = {
    removed: [],
  };
  if (!fs.existsSync(directory)) {
    return result;
  }

  for (const entry of fs.readdirSync(directory)) {
    const runDir = path.join(directory, entry);
    const runFile = path.join(runDir, "run.json");
    if (!fs.existsSync(runFile)) {
      continue;
    }
    fs.rmSync(runDir, { recursive: true, force: true });
    result.removed.push(entry);
  }

  return result;
}

export function writeRunHandoff(cockpitDir: string, runId: string, contents: string): string {
  const activePath = path.join(runDirectory(activeRunsDir(cockpitDir), runId), "handoff.md");
  const archivePath = path.join(runDirectory(archiveRunsDir(cockpitDir), runId), "handoff.md");
  const target = fs.existsSync(path.dirname(activePath)) ? activePath : archivePath;
  fs.writeFileSync(target, contents, "utf8");
  return target;
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
