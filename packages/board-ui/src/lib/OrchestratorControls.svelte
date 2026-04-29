<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import {
    fetchOrchestratePlan,
    fetchOrchestratorState,
    pauseOrchestrator,
    startOrchestrator,
    stopOrchestrator,
  } from "./api.js";
  import { t } from "./i18n.svelte.js";
  import type { OrchestratorState } from "./types.js";

  interface Props {
    onError?: (message: string) => void;
  }

  let { onError }: Props = $props();

  let orchestrator = $state<OrchestratorState | null>(null);
  let runnableCount = $state<number | null>(null);
  let blockedByAgent = $state(false);
  let busy = $state(false);
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  async function refresh() {
    try {
      const [orchState, plan] = await Promise.all([
        fetchOrchestratorState(),
        fetchOrchestratePlan().catch(() => null),
      ]);
      orchestrator = orchState;
      runnableCount = plan?.runnable_count ?? null;
      // Distinguish "empty board" from "tasks exist but no enabled
      // agent can run them" — they need different copy on the disabled
      // Play button. The latter is the common case after `backlog init`
      // since manual-default is the only seeded agent enabled, and
      // manual is non-executable.
      blockedByAgent = (plan?.blocked ?? []).some((d) =>
        d.reasons.includes("no_compatible_agent"),
      );
    } catch (err) {
      onError?.(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleStart() {
    busy = true;
    try {
      orchestrator = await startOrchestrator({});
    } catch (err) {
      onError?.(err instanceof Error ? err.message : String(err));
    } finally {
      busy = false;
    }
  }

  async function handlePause() {
    busy = true;
    try {
      orchestrator = await pauseOrchestrator();
    } catch (err) {
      onError?.(err instanceof Error ? err.message : String(err));
    } finally {
      busy = false;
    }
  }

  async function handleStop() {
    busy = true;
    try {
      orchestrator = await stopOrchestrator();
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

  const mode = $derived(orchestrator?.mode ?? "idle");
  const isRunning = $derived(mode === "running");
  const isPaused = $derived(mode === "paused");
  const isStopping = $derived(mode === "stopping");
  const nothingToRun = $derived(runnableCount !== null && runnableCount === 0);
  const playTitle = $derived(
    isRunning
      ? t("orchestrator.play.running")
      : nothingToRun
        ? blockedByAgent
          ? t("orchestrator.play.no_agent")
          : t("orchestrator.play.nothing")
        : t("orchestrator.play.start"),
  );
  const modeLabel = $derived(t(`orchestrator.mode.${mode}`));
</script>

<div class="controls" role="toolbar" aria-label="Orchestrator controls">
  <button
    class="ctrl play"
    class:active={isRunning}
    onclick={handleStart}
    disabled={busy || isRunning || nothingToRun}
    title={playTitle}
    aria-label="Play"
  >
    ▶
  </button>
  <button
    class="ctrl pause"
    class:active={isPaused}
    onclick={handlePause}
    disabled={busy || !isRunning}
    title={t("orchestrator.pause.title")}
    aria-label="Pause"
  >
    ⏸
  </button>
  <button
    class="ctrl stop"
    class:active={isStopping}
    onclick={handleStop}
    disabled={busy || mode === "idle"}
    title={t("orchestrator.stop.title")}
    aria-label="Stop"
  >
    ⏹
  </button>
  <span class="state state-{mode}">{modeLabel}</span>
  {#if runnableCount !== null && runnableCount > 0 && !isRunning}
    <span class="ready">{t(runnableCount === 1 ? "topbar.ready_count_one" : "topbar.ready_count_many", { count: runnableCount })}</span>
  {/if}
  {#if orchestrator?.last_started_count !== undefined && orchestrator.last_started_count > 0}
    <span class="count">+{orchestrator.last_started_count}</span>
  {/if}
</div>

<style>
  .controls {
    display: inline-flex;
    align-items: center;
    background: var(--bg-hover);
    border: 1px solid var(--border-strong);
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
    color: var(--text-secondary);
    border-radius: 4px;
    transition: background-color 120ms ease;
  }
  .ctrl:hover:not(:disabled) {
    background: var(--bg-surface);
    color: var(--text-primary);
  }
  .ctrl:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
  .ctrl.play.active { background: var(--success-bg); color: var(--success); }
  .ctrl.pause.active { background: var(--warning-bg); color: var(--warning); }
  .ctrl.stop.active { background: var(--danger-bg); color: var(--danger); }

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
  .state-idle { background: var(--text-subtle); }
  .state-running { background: var(--success); }
  .state-paused { background: #f79009; }
  .state-stopping { background: var(--danger); }
  .ready {
    font-size: 10px;
    color: var(--accent);
    font-weight: 600;
    margin-left: 4px;
    padding: 2px 6px;
    background: var(--accent-bg);
    border-radius: 10px;
  }
  .count {
    font-size: 10px;
    color: var(--success);
    font-weight: 600;
    margin-left: 2px;
  }
</style>
