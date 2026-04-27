import { loadConfig } from "@backlog/config";
import type { OrchestratorMode, OrchestratorState } from "@backlog/schemas";
import { getOrchestratorState, updateOrchestratorState } from "./orchestrator-state.js";
import { listActiveRuns } from "./run-store.js";
import { startRunsForPlan, type StartRunsResult } from "./run-launcher.js";
import { buildExecutionPlan } from "./scheduler.js";

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
    if (remaining === 0 || plan.runnable.length === 0) {
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
      scheduleNextTick(backlogDir, state.tick_interval_ms);
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

export async function hydrateOrchestrator(backlogDir: string, options?: { now?: number }): Promise<OrchestratorState> {
  const state = getOrchestratorState(backlogDir);
  if (state.mode !== "running") return state;
  const now = options?.now ?? Date.now();
  const lastTickMs = state.last_tick_at ? Date.parse(state.last_tick_at) : 0;
  const stale = !state.last_tick_at || !Number.isFinite(lastTickMs) || now - lastTickMs > STALE_HYDRATE_MS;
  if (stale) {
    return updateOrchestratorState(backlogDir, {
      mode: "idle",
      started_at: null,
      paused_at: null,
      last_error: "stale_hydrate",
    });
  }
  scheduleNextTick(backlogDir, state.tick_interval_ms);
  return state;
}

export function shutdownOrchestrator(backlogDir: string): void {
  const handle = runtime(backlogDir);
  clearTimer(handle);
  clearStopWaiter(handle);
  RUNTIMES.delete(backlogDir);
}

export function currentOrchestratorMode(backlogDir: string): OrchestratorMode {
  return getOrchestratorState(backlogDir).mode;
}
