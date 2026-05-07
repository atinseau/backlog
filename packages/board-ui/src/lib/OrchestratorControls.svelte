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
    onStarted?: () => void;
    onPlay?: () => Promise<void> | void;
    // True when at least one run is in flight on the board, even if
    // the global orchestrator mode is "idle" (the user can launch a
    // single run via per-card Play without enabling autopilot).
    // Treats us as "running" for the Stop/Play visual so the user
    // can interrupt mid-flight.
    externalActive?: boolean;
    canPlay?: boolean;
    playState?: "blocked" | "empty" | "ready";
    playBlockedTitle?: string;
    // Called when the user clicks Stop while a run is in flight but
    // the global orchestrator isn't running. Lets the parent cancel
    // those individual runs (or no-op).
    onStopActiveRuns?: () => Promise<void> | void;
  }

  let {
    onError,
    onStarted,
    onPlay,
    externalActive = false,
    canPlay = true,
    playState = "ready",
    playBlockedTitle = "",
    onStopActiveRuns,
  }: Props = $props();

  let orchestrator = $state<OrchestratorState | null>(null);
  let runnableCount = $state<number | null>(null);
  let blockedByAgent = $state(false);
  let startBusy = $state(false);
  let stopBusy = $state(false);
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
    startBusy = true;
    try {
      // The parent owns the "what to start" decision (it has the
      // board state). Fall back to the orchestrator-level start when
      // no callback is provided so this component keeps working in
      // isolation (tests / standalone usage).
      if (onPlay) {
        await onPlay();
      } else {
        orchestrator = await startOrchestrator({});
      }
      onStarted?.();
    } catch (err) {
      onError?.(err instanceof Error ? err.message : String(err));
    } finally {
      startBusy = false;
    }
  }

  async function handleStop() {
    stopBusy = true;
    try {
      // Two cases: global orchestrator running → stop it. Otherwise
      // the user has individual runs in flight and the parent owns
      // how to cancel them.
      if (orchestratorRunning) {
        orchestrator = await stopOrchestrator();
      } else if (externalActive) {
        await onStopActiveRuns?.();
      }
    } catch (err) {
      onError?.(err instanceof Error ? err.message : String(err));
    } finally {
      stopBusy = false;
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
  const orchestratorRunning = $derived(mode === "running" || mode === "paused" || mode === "stopping");
  // "Running" for the visual + button state = global orchestrator OR
  // any per-card run still in flight on the board.
  const isRunning = $derived(orchestratorRunning || externalActive);
  const nothingToRun = $derived(runnableCount !== null && runnableCount === 0);

  const playTitle = $derived(
    isRunning
      ? t("orchestrator.play.running")
      : playState === "blocked"
        ? playBlockedTitle || t("orchestrator.play.nothing")
      : playState === "empty" || nothingToRun
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
       running; Play is greyed while work is already in flight. -->
  <button
    class="ctrl stop"
    onclick={handleStop}
    disabled={stopBusy || !isRunning}
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
    class:empty={playState === "empty" && !isRunning}
    onclick={handleStart}
    disabled={startBusy || isRunning || playState !== "ready" || !canPlay}
    title={playTitle}
    aria-label="Play"
  >
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path d="M3.7 2.6c0-.7.8-1.2 1.4-.8l6.4 4c.6.4.6 1.2 0 1.6l-6.4 4c-.6.4-1.4-.1-1.4-.8V2.6Z" fill="currentColor" />
    </svg>
  </button>
</div>

<style>
  /* Frameless transport pair. The two buttons overlap by 4px so they
     read as a single tightly-paired control. The hover background is
     a circle inside the button, so the overlap doesn't create visible
     artefacts. */
  .controls {
    display: inline-flex;
    align-items: center;
  }
  .ctrl {
    width: 38px;
    height: 38px;
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
  .ctrl + .ctrl { margin-left: -10px; }
  .ctrl :global(svg) { width: 16px; height: 16px; }
  .ctrl:hover:not(:disabled) {
    background: var(--bg-hover);
  }
  /* Play is the affirmative action while idle, then goes disabled while
     a run is active so it cannot launch the same work twice. */
  .ctrl.play {
    color: var(--accent-on);
    background: var(--accent);
  }
  .ctrl.play:disabled {
    cursor: not-allowed;
    background: transparent;
    color: var(--text-subtle);
  }
  .ctrl.play.empty:disabled {
    color: var(--text-primary);
  }
  .ctrl.play:hover:not(:disabled) {
    background: var(--accent-hover);
  }
  .ctrl.play.running:not(:disabled) {
    color: var(--success);
    background: var(--success-bg);
    opacity: 1;
  }
  .ctrl.play.running:hover:not(:disabled) { background: var(--success-bg); }

  /* Stop turns red + interactive when something is running, otherwise
     it sits greyed (visible but non-clickable). */
  .ctrl.stop:disabled {
    color: var(--text-subtle);
    cursor: not-allowed;
  }
  .ctrl.stop:not(:disabled) {
    color: var(--danger);
  }
  .ctrl.stop:not(:disabled):hover {
    background: var(--danger-bg);
  }
</style>
