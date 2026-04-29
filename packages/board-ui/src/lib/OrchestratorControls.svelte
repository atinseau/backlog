<script lang="ts">
  // Minimal orchestrator surface in the topbar: just Play and Stop.
  // Pause moved to the OrchestratorChat emergency-controls panel since
  // it's a "we're already running, slow it down" action — not a primary
  // user gesture from the header.
  import { onDestroy, onMount } from "svelte";
  import {
    fetchOrchestratePlan,
    fetchOrchestratorState,
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
    pollTimer = setInterval(refresh, 5000);
  });
  onDestroy(() => {
    if (pollTimer) clearInterval(pollTimer);
  });

  export function reload() {
    refresh();
  }

  const mode = $derived(orchestrator?.mode ?? "idle");
  const isRunning = $derived(mode === "running" || mode === "paused" || mode === "stopping");
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
  const stopTitle = $derived(
    isRunning ? t("orchestrator.stop.title") : t("orchestrator.stop.idle"),
  );
</script>

<div class="controls" role="toolbar" aria-label="Orchestrator controls">
  <!-- Stop on the left, Play on the right (DAW / tape-recorder convention
       of "destructive action first"). Stop is greyed when nothing is
       running; Play stays bright + clickable so the user always has a
       way to launch. -->
  <button
    class="ctrl stop"
    onclick={handleStop}
    disabled={busy || !isRunning}
    title={stopTitle}
    aria-label="Stop"
  >
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <rect x="2" y="2" width="10" height="10" rx="2" fill="currentColor" />
    </svg>
  </button>
  <button
    class="ctrl play"
    class:running={isRunning}
    onclick={handleStart}
    disabled={busy || isRunning || nothingToRun}
    title={playTitle}
    aria-label="Play"
  >
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path d="M3.7 2.6c0-.7.8-1.2 1.4-.8l6.4 4c.6.4.6 1.2 0 1.6l-6.4 4c-.6.4-1.4-.1-1.4-.8V2.6Z" fill="currentColor" />
    </svg>
  </button>
</div>

<style>
  /* Frameless — sits alongside the project selector with no enclosing
     box. Buttons are 32px circles (touch-target friendly) with 2px gap
     so the pair reads as a single unit. */
  .controls {
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }
  .ctrl {
    width: 32px;
    height: 32px;
    border: none;
    border-radius: 50%;
    background: transparent;
    cursor: pointer;
    color: var(--text-primary);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    transition: background 120ms ease, color 120ms ease;
  }
  .ctrl:hover:not(:disabled) {
    background: var(--bg-hover);
  }
  .ctrl:disabled {
    color: var(--text-subtle);
    cursor: not-allowed;
  }
  /* Play stays bright (white text in dark mode, near-black in light)
     and clickable until it's actually running. */
  .ctrl.play.running {
    color: var(--success);
    background: var(--success-bg);
  }
  .ctrl.play.running:hover { background: var(--success-bg); }

  /* Stop turns red when there's a run to interrupt, otherwise the
     disabled style takes over (greyed, not interactive). */
  .ctrl.stop:not(:disabled) {
    color: var(--danger);
  }
  .ctrl.stop:not(:disabled):hover {
    background: var(--danger-bg);
  }
</style>
