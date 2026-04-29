import fs from "node:fs";
import path from "node:path";
import { runSchema, type Artifact, type Run, type SubTask, type Task } from "@backlog/schemas";
import type { Agent } from "@backlog/schemas";
import { makeId } from "./id.js";

function activeRunsDir(backlogDir: string): string {
  return path.join(backlogDir, "runs", "active");
}

function archiveRunsDir(backlogDir: string): string {
  return path.join(backlogDir, "runs", "archive");
}

function runDirectory(baseDir: string, runId: string): string {
  return path.join(baseDir, runId);
}

export function nextRunId(): string {
  return makeId("RUN");
}

export function createRun(params: {
  backlogDir: string;
  runId: string;
  task: SubTask;
  workItem: Task;
  agent: Agent;
  branch: string;
  worktreePath: string;
  claimIds: string[];
}): Run {
  const directory = runDirectory(activeRunsDir(params.backlogDir), params.runId);
  fs.mkdirSync(directory, { recursive: true });

  const run: Run = {
    version: 1,
    id: params.runId,
    subtask_id: params.task.id,
    task_id: params.workItem.id,
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

  writeRun(params.backlogDir, run);
  appendRunEvent(params.backlogDir, run.id, {
    ts: new Date().toISOString(),
    type: "run.created",
    message: `Created run ${run.id}`,
  });
  return run;
}

export function writeRun(backlogDir: string, run: Run): void {
  const directory = runDirectory(activeRunsDir(backlogDir), run.id);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "run.json"), JSON.stringify(runSchema.parse(run), null, 2) + "\n", "utf8");
}

export function appendRunEvent(backlogDir: string, runId: string, event: Record<string, string>): void {
  const activePath = path.join(runDirectory(activeRunsDir(backlogDir), runId), "events.ndjson");
  const archivePath = path.join(runDirectory(archiveRunsDir(backlogDir), runId), "events.ndjson");
  const eventsPath = fs.existsSync(path.dirname(activePath)) ? activePath : archivePath;
  fs.appendFileSync(eventsPath, JSON.stringify(event) + "\n", "utf8");
}

export function listActiveRuns(backlogDir: string): Run[] {
  const directory = activeRunsDir(backlogDir);
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

export function getRunEvents(backlogDir: string, runId: string): string[] {
  const activeEventsPath = path.join(activeRunsDir(backlogDir), runId, "events.ndjson");
  const archiveEventsPath = path.join(archiveRunsDir(backlogDir), runId, "events.ndjson");
  const target = fs.existsSync(activeEventsPath) ? activeEventsPath : archiveEventsPath;
  if (!fs.existsSync(target)) {
    return [];
  }
  return fs.readFileSync(target, "utf8").split("\n").filter(Boolean);
}

export function loadRun(backlogDir: string, runId: string): Run | null {
  const activePath = path.join(activeRunsDir(backlogDir), runId, "run.json");
  const archivePath = path.join(archiveRunsDir(backlogDir), runId, "run.json");
  const target = fs.existsSync(activePath) ? activePath : archivePath;
  if (!fs.existsSync(target)) {
    return null;
  }
  return runSchema.parse(JSON.parse(fs.readFileSync(target, "utf8")) as unknown);
}

export function updateRunStatus(backlogDir: string, runId: string, status: Run["status"], result?: string): Run {
  const current = loadRun(backlogDir, runId);
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
  writeRun(backlogDir, next);
  appendRunEvent(backlogDir, runId, {
    ts: new Date().toISOString(),
    type: "run.status",
    message: `Run moved to ${status}`,
  });
  return next;
}

export function isTerminalRunStatus(status: Run["status"]): boolean {
  return status === "succeeded" || status === "failed" || status === "blocked" || status === "canceled";
}

// "Holding the agent slot" — runs that are still doing something on
// the agent's CPU/CLI side, as opposed to awaiting human review.
// Used by the planner to compute concurrency: a run sitting in
// awaiting_review doesn't keep the agent busy, so it shouldn't block
// the next task from being scheduled to the same agent.
export function isAgentBusyStatus(status: Run["status"]): boolean {
  return status === "queued" || status === "preparing" || status === "running" || status === "interrupted";
}

export function listAllRuns(backlogDir: string): Run[] {
  const directories = [
    activeRunsDir(backlogDir),
    archiveRunsDir(backlogDir),
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

export function listArchivedRuns(backlogDir: string): Run[] {
  const directory = archiveRunsDir(backlogDir);
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

export function archiveRun(backlogDir: string, runId: string): Run {
  const run = loadRun(backlogDir, runId);
  if (!run) {
    throw new Error(`Unknown run: ${runId}`);
  }
  const activeDir = runDirectory(activeRunsDir(backlogDir), runId);
  const archiveDir = runDirectory(archiveRunsDir(backlogDir), runId);
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

export function garbageCollectArchivedRuns(backlogDir: string): RunGcResult {
  const directory = archiveRunsDir(backlogDir);
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

export function writeRunHandoff(backlogDir: string, runId: string, contents: string): string {
  const activePath = path.join(runDirectory(activeRunsDir(backlogDir), runId), "handoff.md");
  const archivePath = path.join(runDirectory(archiveRunsDir(backlogDir), runId), "handoff.md");
  const target = fs.existsSync(path.dirname(activePath)) ? activePath : archivePath;
  fs.writeFileSync(target, contents, "utf8");
  return target;
}

export function getRunHandoffPath(backlogDir: string, runId: string): string | null {
  const activePath = path.join(runDirectory(activeRunsDir(backlogDir), runId), "handoff.md");
  if (fs.existsSync(activePath)) {
    return activePath;
  }

  const archivePath = path.join(runDirectory(archiveRunsDir(backlogDir), runId), "handoff.md");
  if (fs.existsSync(archivePath)) {
    return archivePath;
  }

  return null;
}

export function addRunArtifact(backlogDir: string, runId: string, artifact: Artifact): Run {
  const current = loadRun(backlogDir, runId);
  if (!current) {
    throw new Error(`Unknown run: ${runId}`);
  }
  const next = {
    ...current,
    artifacts: [...current.artifacts, artifact],
  };
  writeRun(backlogDir, next);
  return next;
}
