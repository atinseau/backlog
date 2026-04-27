<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import {
    fetchOrchestratorState,
    pauseOrchestrator,
    startOrchestrator,
    stopOrchestrator,
  } from "./api.js";
  import type { OrchestratorState } from "./types.js";

  interface Props {
    onError?: (message: string) => void;
  }

  let { onError }: Props = $props();

  let state = $state<OrchestratorState | null>(null);
  let busy = $state(false);
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  async function refresh() {
    try {
      state = await fetchOrchestratorState();
    } catch (err) {
      onError?.(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleStart() {
    busy = true;
    try {
      state = await startOrchestrator({});
    } catch (err) {
      onError?.(err instanceof Error ? err.message : String(err));
    } finally {
      busy = false;
    }
  }

  async function handlePause() {
    busy = true;
    try {
      state = await pauseOrchestrator();
    } catch (err) {
      onError?.(err instanceof Error ? err.message : String(err));
    } finally {
      busy = false;
    }
  }

  async function handleStop() {
    busy = true;
    try {
      state = await stopOrchestrator();
    } catch (err) {
      onError?.(err instanceof Error ? err.message : String(err));
    } finally {
      busy = false;
    }
  }

  onMount(() => {
    refresh();
    // Poll every 5s as a safety net; SSE handles the live updates.
    pollTimer = setInterval(refresh, 5000);
  });

  onDestroy(() => {
    if (pollTimer) clearInterval(pollTimer);
  });

  export function reload() {
    refresh();
  }

  const mode = $derived(state?.mode ?? "idle");
  const isRunning = $derived(mode === "running");
  const isPaused = $derived(mode === "paused");
  const isStopping = $derived(mode === "stopping");
</script>

<div class="controls" role="toolbar" aria-label="Orchestrator controls">
  <button
    class="ctrl play"
    class:active={isRunning}
    onclick={handleStart}
    disabled={busy || isRunning}
    title="Démarrer l'orchestrateur"
    aria-label="Play"
  >
    ▶
  </button>
  <button
    class="ctrl pause"
    class:active={isPaused}
    onclick={handlePause}
    disabled={busy || !isRunning}
    title="Pause (les runs actifs continuent)"
    aria-label="Pause"
  >
    ⏸
  </button>
  <button
    class="ctrl stop"
    class:active={isStopping}
    onclick={handleStop}
    disabled={busy || mode === "idle"}
    title="Stop (attend la fin des runs actifs)"
    aria-label="Stop"
  >
    ⏹
  </button>
  <span class="state state-{mode}">{mode}</span>
  {#if state?.last_started_count !== undefined && state.last_started_count > 0}
    <span class="count">+{state.last_started_count}</span>
  {/if}
</div>

<style>
  .controls {
    display: inline-flex;
    align-items: center;
    background: #f2f4f7;
    border: 1px solid #d0d5dd;
    border-radius: 6px;
    padding: 2px;
    gap: 1px;
  }
  .ctrl {
    background: transparent;
    border: none;
    padding: 4px 10px;
    cursor: pointer;
    font-size: 13px;
    color: #475467;
    border-radius: 4px;
    transition: background-color 120ms ease;
  }
  .ctrl:hover:not(:disabled) {
    background: white;
    color: #1d2939;
  }
  .ctrl:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
  .ctrl.play.active { background: #d1fadf; color: #027a48; }
  .ctrl.pause.active { background: #fef0c7; color: #b54708; }
  .ctrl.stop.active { background: #fee4e2; color: #b42318; }

  .state {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 10px;
    margin-left: 4px;
    color: white;
  }
  .state-idle { background: #98a2b3; }
  .state-running { background: #027a48; }
  .state-paused { background: #f79009; }
  .state-stopping { background: #b42318; }
  .count {
    font-size: 10px;
    color: #027a48;
    font-weight: 600;
    margin-left: 2px;
  }
</style>
