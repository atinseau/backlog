import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "@backlog/config";
import type { OrchestratorMode, OrchestratorState } from "@backlog/schemas";
import { getOrchestratorState, updateOrchestratorState } from "./orchestrator-state.js";
import {
  appendRunEvent,
  archiveRun,
  isTerminalRunStatus,
  listActiveRuns,
  updateRunStatus,
} from "./run-store.js";
import type { Run } from "@backlog/schemas";
import { listSubTasks } from "./state-files.js";
import { startRunsForPlan, type StartRunsResult } from "./run-launcher.js";
import { buildExecutionPlan } from "./scheduler.js";
import { updateSubTaskStatus } from "./subtask-service.js";
import { updateTaskStatus } from "./task-service.js";
import { runSubTaskId, runTargetType } from "./execution-target.js";
import { garbageCollectWorktrees } from "./worktrees.js";

// A live executor writes to events.ndjson at least at start, on every
// tool call, and at finish. If the file hasn't moved in this many ms
// AND the run is still marked running/preparing, the executor is dead
// (server crashed mid-run, kill -9, or — common during dev — the
// server was restarted with a child still in flight). 90s is the
// threshold: long enough to cover a slow Claude Code turn that doesn't
// emit interim events, short enough that a real orphan doesn't sit
// for hours blocking the orchestrator.
const ORPHAN_RUN_THRESHOLD_MS = 90_000;

export interface OrchestratorStartInput {
  max_agents?: number;
  auto_pick_agents?: boolean;
  tick_interval_ms?: number;
}

interface RuntimeHandle {
  timer: ReturnType<typeof setTimeout> | null;
  ticking: boolean;
  stopWaiter: NodeJS.Timeout | null;
}

const RUNTIMES = new Map<string, RuntimeHandle>();
const STALE_HYDRATE_MS = 60_000;

// Adaptive backoff: when the orchestrator finds nothing to do for
// N consecutive ticks, double the next tick interval until we hit a
// ceiling. The moment something runs, snap back to the configured
// base interval. Saves disk + CPU + iCloud-watcher noise on idle
// workspaces while keeping responsiveness when work is actually
// queued. Numbers picked to feel snappy: 5 idle ticks (≈25s at the
// 5s default) before backoff kicks in, 12× max (so 5s base → 60s
// idle ceiling).
const IDLE_TICKS_BEFORE_BACKOFF = 5;
const MAX_BACKOFF_MULTIPLIER = 12;

interface BackoffState {
  consecutiveIdle: number;
}
const BACKOFF = new Map<string, BackoffState>();

function backoffState(backlogDir: string): BackoffState {
  let s = BACKOFF.get(backlogDir);
  if (!s) {
    s = { consecutiveIdle: 0 };
    BACKOFF.set(backlogDir, s);
  }
  return s;
}

function nextIntervalMs(baseMs: number, consecutiveIdle: number): number {
  if (consecutiveIdle <= IDLE_TICKS_BEFORE_BACKOFF) return baseMs;
  const overflow = consecutiveIdle - IDLE_TICKS_BEFORE_BACKOFF;
  const multiplier = Math.min(MAX_BACKOFF_MULTIPLIER, 2 ** overflow);
  return baseMs * multiplier;
}

function runtime(backlogDir: string): RuntimeHandle {
  let handle = RUNTIMES.get(backlogDir);
  if (!handle) {
    handle = { timer: null, ticking: false, stopWaiter: null };
    RUNTIMES.set(backlogDir, handle);
  }
  return handle;
}

function clearTimer(handle: RuntimeHandle): void {
  if (handle.timer) {
    clearTimeout(handle.timer);
    handle.timer = null;
  }
}

function clearStopWaiter(handle: RuntimeHandle): void {
  if (handle.stopWaiter) {
    clearInterval(handle.stopWaiter);
    handle.stopWaiter = null;
  }
}

function activeRunCount(backlogDir: string): number {
  return listActiveRuns(backlogDir).filter((run) => run.status === "running" || run.status === "preparing").length;
}

export async function orchestratorTick(backlogDir: string): Promise<StartRunsResult | null> {
  const handle = runtime(backlogDir);
  if (handle.ticking) return null;
  handle.ticking = true;
  try {
    const state = getOrchestratorState(backlogDir);
    if (state.mode !== "running") return null;

    const config = loadConfig(backlogDir);
    const plan = buildExecutionPlan(backlogDir, config);

    const inFlight = activeRunCount(backlogDir);
    const targetMax = state.auto_pick_agents
      ? Math.min(plan.runnable.length, Math.max(1, state.max_agents))
      : state.max_agents;
    const remaining = Math.max(0, targetMax - inFlight);
    const backoff = backoffState(backlogDir);
    if (remaining === 0 || plan.runnable.length === 0) {
      backoff.consecutiveIdle++;
      updateOrchestratorState(backlogDir, {
        last_tick_at: new Date().toISOString(),
        last_started_count: 0,
        last_error: null,
      });
      return { started: [], skipped: [] };
    }

    const result = await startRunsForPlan({
      backlogDir,
      config,
      plan,
      maxStart: remaining,
    });
    // Snap back to the base interval the moment work actually
    // happens, even if only one run started.
    if (result.started.length > 0) {
      backoff.consecutiveIdle = 0;
    } else {
      backoff.consecutiveIdle++;
    }
    updateOrchestratorState(backlogDir, {
      last_tick_at: new Date().toISOString(),
      last_started_count: result.started.length,
      last_error: null,
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateOrchestratorState(backlogDir, {
      last_tick_at: new Date().toISOString(),
      last_error: message,
    });
    return null;
  } finally {
    handle.ticking = false;
  }
}

function scheduleNextTick(backlogDir: string, intervalMs: number): void {
  const handle = runtime(backlogDir);
  clearTimer(handle);
  handle.timer = setTimeout(async () => {
    await orchestratorTick(backlogDir);
    const state = getOrchestratorState(backlogDir);
    if (state.mode === "running") {
      // Adaptive interval: the more consecutive idle ticks we've had,
      // the longer we wait before the next one. The base interval is
      // recovered the next time work fires.
      const backoff = backoffState(backlogDir);
      const wait = nextIntervalMs(state.tick_interval_ms, backoff.consecutiveIdle);
      scheduleNextTick(backlogDir, wait);
    }
  }, intervalMs);
  if (typeof handle.timer === "object" && "unref" in handle.timer) {
    handle.timer.unref?.();
  }
}

export async function startOrchestrator(
  backlogDir: string,
  input: OrchestratorStartInput = {},
): Promise<OrchestratorState> {
  const previous = getOrchestratorState(backlogDir);
  const config = loadConfig(backlogDir);
  const max = input.max_agents ?? previous.max_agents ?? config.max_agents;
  const next = updateOrchestratorState(backlogDir, {
    mode: "running",
    max_agents: max,
    auto_pick_agents: input.auto_pick_agents ?? previous.auto_pick_agents,
    tick_interval_ms: input.tick_interval_ms ?? previous.tick_interval_ms,
    started_at: new Date().toISOString(),
    paused_at: null,
    last_error: null,
  });
  await orchestratorTick(backlogDir);
  scheduleNextTick(backlogDir, next.tick_interval_ms);
  return getOrchestratorState(backlogDir);
}

export function pauseOrchestrator(backlogDir: string): OrchestratorState {
  const handle = runtime(backlogDir);
  clearTimer(handle);
  return updateOrchestratorState(backlogDir, {
    mode: "paused",
    paused_at: new Date().toISOString(),
  });
}

export async function stopOrchestrator(backlogDir: string): Promise<OrchestratorState> {
  const handle = runtime(backlogDir);
  clearTimer(handle);
  let state = updateOrchestratorState(backlogDir, { mode: "stopping" });
  if (activeRunCount(backlogDir) === 0) {
    return updateOrchestratorState(backlogDir, {
      mode: "idle",
      started_at: null,
      paused_at: null,
    });
  }
  return new Promise<OrchestratorState>((resolve) => {
    clearStopWaiter(handle);
    handle.stopWaiter = setInterval(() => {
      if (activeRunCount(backlogDir) === 0) {
        clearStopWaiter(handle);
        state = updateOrchestratorState(backlogDir, {
          mode: "idle",
          started_at: null,
          paused_at: null,
        });
        resolve(state);
      }
    }, 1000);
  });
}

export function setOrchestratorConfig(
  backlogDir: string,
  input: { max_agents?: number; auto_pick_agents?: boolean; tick_interval_ms?: number },
): OrchestratorState {
  return updateOrchestratorState(backlogDir, input);
}

function reapOrphanedRuns(backlogDir: string, now: number): void {
  // First pass: subtasks marked running/planned with no live run linked
  // back to them (or whose run died terminally without resetting the
  // subtask). Symptom: card sits in EN COURS forever, scheduler skips
  // it because it looks busy.
  const runs = listActiveRuns(backlogDir);
  const liveRunSubtaskIds = new Set(
    runs
      .filter((r) => r.status === "running" || r.status === "preparing")
      .map(runSubTaskId)
      .filter((id): id is string => id !== null),
  );
  for (const sub of listSubTasks(backlogDir)) {
    if (sub.status !== "running") continue;
    if (liveRunSubtaskIds.has(sub.id)) continue;
    try {
      // "queued" (not "planned") so the parent task derives back to
      // "ready" and the card returns to À FAIRE — clearer signal to
      // the user that nothing is in flight than leaving it in EN
      // COURS as a "planned" subtask would.
      updateSubTaskStatus(backlogDir, sub.id, "queued");
    } catch {
      // best effort
    }
  }

  for (const run of runs) {
    if (run.status !== "running" && run.status !== "preparing") continue;
    const eventsPath = path.join(backlogDir, "runs", "active", run.id, "events.ndjson");
    let lastTouchMs = 0;
    try {
      const stat = fs.statSync(eventsPath);
      lastTouchMs = stat.mtimeMs;
    } catch {
      // No events file at all — definitely orphan (executor never even
      // got past the create step). Use the run's started_at as the
      // last-known-alive timestamp; if even that's missing, fall back
      // to "ancient" so reaping definitely fires.
      lastTouchMs = run.started_at ? Date.parse(run.started_at) : 0;
    }
    if (!Number.isFinite(lastTouchMs)) lastTouchMs = 0;
    if (now - lastTouchMs < ORPHAN_RUN_THRESHOLD_MS) continue;

    try {
      updateRunStatus(backlogDir, run.id, "interrupted", "Reaped on hydrate — executor process gone");
      appendRunEvent(backlogDir, run.id, {
        ts: new Date().toISOString(),
        type: "run.reaped",
        message: `Run was marked '${run.status}' but its events.ndjson hadn't been touched in ${Math.round((now - lastTouchMs) / 1000)}s. Server presumed the executor died.`,
      });
      if (runTargetType(run) === "task") {
        updateTaskStatus(backlogDir, run.task_id, "ready");
      } else {
        const subtaskId = runSubTaskId(run);
        if (subtaskId) updateSubTaskStatus(backlogDir, subtaskId, "queued");
      }
    } catch {
      // Best-effort cleanup; if the subtask is already gone the run
      // was for a removed task and there's nothing to fix.
    }
  }
}

export async function hydrateOrchestrator(backlogDir: string, options?: { now?: number }): Promise<OrchestratorState> {
  // Reap orphaned runs first — runs marked running/preparing whose
  // executor subprocess died with the previous server (kill -9, crash,
  // or — most commonly during dev — a `kill <pid>` followed by a fresh
  // `backlog serve`). Without this, the subtask sits forever in
  // `running` and the orchestrator quietly skips it because it looks
  // like work is in flight. We use the absence of recent events.ndjson
  // writes as the staleness signal: an executor that's actually doing
  // work touches that file at least every minute.
  reapOrphanedRuns(backlogDir, options?.now ?? Date.now());

  // Sweep `runs/active/` for terminal runs and move them to archive.
  // Two ways a run can end up terminal-but-still-active:
  //   1. The reaper above just marked it `interrupted` — that's now
  //      treated as terminal (see isTerminalRunStatus in run-store)
  //      so it shouldn't keep squatting active/.
  //   2. A run completed cleanly in a previous session, but the
  //      `archiveRun` call after the executor returned was skipped
  //      (server crashed mid-finalisation, sigkill during a tick…).
  // The user-reported bug ("Ton agent est déjà en train de tourner")
  // was exactly this — a 2-day-old `interrupted` run was pinning
  // claude-opus at full capacity. Doing this on every hydrate
  // keeps the directory honest from now on.
  try {
    const activeDir = path.join(backlogDir, "runs", "active");
    if (fs.existsSync(activeDir)) {
      for (const entry of fs.readdirSync(activeDir)) {
        const runJson = path.join(activeDir, entry, "run.json");
        if (!fs.existsSync(runJson)) continue;
        try {
          const raw = JSON.parse(fs.readFileSync(runJson, "utf8")) as { status?: string; id?: string };
          if (raw.id && raw.status && isTerminalRunStatus(raw.status as Run["status"])) {
            archiveRun(backlogDir, raw.id);
          }
        } catch {
          // Corrupt run.json — leave it; user can clean manually.
        }
      }
    }
  } catch {
    // Best effort; never block server startup on cleanup.
  }

  // Clean up orphaned worktrees from runs that have already been
  // archived. A run that ended `failed` or `interrupted` left its
  // git worktree (and its branch) sitting on disk — the next time
  // the user retried the same subtask the new run would collide on
  // the branch name (with the older buildRunBranchName that didn't
  // include runId, this was guaranteed; now the branch is unique
  // per run but the worktree directories still pile up). Sweep them
  // here so the repo and disk stay tidy. Best-effort; if a worktree
  // is locked or git misbehaves we skip and move on.
  try {
    const config = loadConfig(backlogDir);
    if (config) {
      await garbageCollectWorktrees(backlogDir, config).catch(() => undefined);
    }
  } catch {
    // Loader errors, missing config, etc. — non-fatal at startup.
  }

  // Always reset the orchestrator to `idle` on hydrate. Originally we
  // resumed a running orchestrator across server restarts so the daemon
  // would keep ticking after a `backlog serve` restart. In practice
  // this surprised users badly: a quick app relaunch would surface
  // a queue full of stale `queued` subtasks (left over from runs that
  // were interrupted, reaped, etc.) and the orchestrator immediately
  // started firing N runs in parallel before the user even got to
  // their kanban. The user reported exactly this — opened Backlog
  // 1.4.11, 3 unrelated runs (run_024 / run_025 / run_026) auto-fired
  // on stale subtasks before they could click anywhere.
  //
  // New invariant: the user explicitly clicks ▶ (header Play, card
  // Play, or Démarrer in the StartPrompt) to start work. Fresh launches
  // are always quiet. The state file's `mode` is reset to idle so
  // `getOrchestratorState` returns idle next time too.
  const persisted = getOrchestratorState(backlogDir);
  if (persisted.mode !== "idle") {
    return updateOrchestratorState(backlogDir, {
      mode: "idle",
      started_at: null,
      paused_at: null,
    });
  }
  return persisted;
}

export function shutdownOrchestrator(backlogDir: string): void {
  const handle = runtime(backlogDir);
  clearTimer(handle);
  clearStopWaiter(handle);
  RUNTIMES.delete(backlogDir);
  BACKOFF.delete(backlogDir);
}

// Test hook for the adaptive interval. Production code shouldn't
// call this — it lets the unit test verify the backoff curve
// without driving real timer wheels.
export function _internalNextIntervalMs(baseMs: number, consecutiveIdle: number): number {
  return nextIntervalMs(baseMs, consecutiveIdle);
}

export function currentOrchestratorMode(backlogDir: string): OrchestratorMode {
  return getOrchestratorState(backlogDir).mode;
}
