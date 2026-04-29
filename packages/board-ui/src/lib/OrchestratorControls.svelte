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
  <button
    class="ctrl play"
    class:running={isRunning}
    onclick={handleStart}
    disabled={busy || isRunning || nothingToRun}
    title={playTitle}
    aria-label="Play"
  >▶</button>
  <button
    class="ctrl stop"
    onclick={handleStop}
    disabled={busy || !isRunning}
    title={stopTitle}
    aria-label="Stop"
  >⏹</button>
</div>

<style>
  /* Frameless — the buttons live alongside the title with no surrounding
     box or background. Each button is a circle of constant size; state
     is conveyed by colour + the disabled visual. */
  .controls {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .ctrl {
    width: 28px;
    height: 28px;
    border: none;
    border-radius: 50%;
    background: transparent;
    cursor: pointer;
    font-size: 12px;
    line-height: 1;
    color: var(--text-secondary);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    transition: background 120ms ease, color 120ms ease;
  }
  .ctrl:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .ctrl:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
  /* Play is the affirmative action — green when active. */
  .ctrl.play:not(:disabled) {
    color: var(--success);
  }
  .ctrl.play.running {
    color: var(--success);
    background: var(--success-bg);
  }
  /* Stop is the corrective action — red when active. */
  .ctrl.stop:not(:disabled) {
    color: var(--danger);
  }
  .ctrl.stop:not(:disabled):hover {
    background: var(--danger-bg);
  }
</style>
