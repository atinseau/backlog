<script lang="ts">
  import { t } from "./i18n.svelte.js";
  import {
    fetchOrchestratePlan,
    fetchOrchestratorState,
    pauseOrchestrator,
    patchOrchestratorConfig,
    startOrchestrator,
    startRun,
    stopOrchestrator,
    type EnrichedDecision,
    type OrchestratePlan,
  } from "./api.js";
  import type { OrchestratorState } from "./types.js";

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();

  let plan = $state<OrchestratePlan | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let starting = $state<string | null>(null);
  let lastResult = $state<string | null>(null);

  let orchState = $state<OrchestratorState | null>(null);
  let busy = $state(false);
  let maxAgents = $state(3);
  let autoPick = $state(true);

  async function loadState() {
    try {
      orchState = await fetchOrchestratorState();
      maxAgents = orchState.max_agents;
      autoPick = orchState.auto_pick_agents;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  async function handleStart() {
    busy = true;
    error = null;
    try {
      const input: Parameters<typeof startOrchestrator>[0] = {
        max_agents: maxAgents,
        auto_pick_agents: autoPick,
      };
      orchState = await startOrchestrator(input);
      lastResult = "Orchestrateur démarré.";
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }

  async function handlePause() {
    busy = true;
    try {
      orchState = await pauseOrchestrator();
      lastResult = "Orchestrateur en pause (les runs en cours finissent).";
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }

  async function handleStop() {
    busy = true;
    try {
      lastResult = "Arrêt en cours — attente de fin des runs actifs…";
      orchState = await stopOrchestrator();
      lastResult = "Orchestrateur arrêté.";
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }

  async function syncMaxAgents() {
    if (!orchState) return;
    try {
      orchState = await patchOrchestratorConfig({ max_agents: maxAgents, auto_pick_agents: autoPick });
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  async function load() {
    loading = true;
    error = null;
    try {
      [plan] = await Promise.all([fetchOrchestratePlan(), loadState()]);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }

  function decisionTitle(d: EnrichedDecision): string {
    return d.subtask_title ?? d.task_title ?? d.target_id;
  }

  async function startTask(decision: EnrichedDecision) {
    const targetId = decision.target_id;
    starting = targetId;
    error = null;
    lastResult = null;
    try {
      const result = await startRun(
        decision.target_type === "task"
          ? { task_id: decision.task_id, approve: true }
          : { subtask_id: targetId, approve: true },
      );
      if (result.started.length > 0) {
        const item = result.started[0]!;
        lastResult = `Started run ${item.runId} (${item.agentId}) on ${item.branch}`;
      } else if (result.skipped.length > 0) {
        const item = result.skipped[0]!;
        lastResult = `Skipped: ${item.reasons.join(", ")}`;
      } else {
        lastResult = "Nothing to start.";
      }
      await load();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      starting = null;
    }
  }

  $effect(() => {
    load();
  });

  function actionClass(action: EnrichedDecision["action"]): string {
    return `chip act-${action}`;
  }

  function reasonsLine(d: EnrichedDecision): string {
    if (d.reasons.length === 0) return "";
    return d.reasons.slice(0, 3).join(" · ");
  }
</script>

<aside class="panel" aria-label="Orchestrator plan">
  <header>
    <div>
      <h2>{t("orchestrator_panel.title")}</h2>
      {#if plan}
        <p class="meta">
          {plan.runnable_count} runnable now · max {plan.max_agents}
          parallel agent{plan.max_agents > 1 ? "s" : ""}
        </p>
      {/if}
    </div>
    <div class="actions">
      <button onclick={load} disabled={loading} aria-label="Refresh plan">↻</button>
      <button onclick={onClose} aria-label="Close panel">×</button>
    </div>
  </header>

  <section class="controls">
    {#if orchState}
      <div class="state-row">
        <span class="state-pill state-{orchState.mode}">{orchState.mode}</span>
        {#if orchState.last_tick_at}
          <span class="state-meta">tick {new Date(orchState.last_tick_at).toLocaleTimeString("fr-FR")}</span>
        {/if}
        {#if orchState.last_started_count !== undefined && orchState.last_started_count > 0}
          <span class="state-meta">+{orchState.last_started_count} run(s)</span>
        {/if}
      </div>
    {/if}
    <div class="control-row">
      <button class="play" onclick={handleStart} disabled={busy || orchState?.mode === "running"}>▶ Play</button>
      <button onclick={handlePause} disabled={busy || orchState?.mode !== "running"}>⏸ Pause</button>
      <button class="stop" onclick={handleStop} disabled={busy || orchState?.mode === "idle"}>⏹ Stop</button>
    </div>
    <div class="control-row settings">
      <label class="auto">
        <input type="checkbox" bind:checked={autoPick} onchange={syncMaxAgents} />
        Auto
      </label>
      <label class="slider">
        <span>Agents max</span>
        <input
          type="range"
          min="1"
          max="10"
          bind:value={maxAgents}
          onchange={syncMaxAgents}
          disabled={autoPick}
        />
        <span class="slider-val">{maxAgents}</span>
      </label>
    </div>
    {#if orchState?.last_error}
      <div class="warn">⚠ {orchState.last_error}</div>
    {/if}
  </section>

  {#if error}
    <div class="error">{error}</div>
  {/if}

  {#if lastResult}
    <div class="info">{lastResult}</div>
  {/if}

  {#if loading && !plan}
    <div class="placeholder">Computing plan…</div>
  {:else if plan}
    <section class="waves">
      {#if plan.waves.length === 0}
        <div class="placeholder small">No tasks ready to schedule.</div>
      {/if}
      {#each plan.waves as wave (wave.wave)}
        <article class="wave">
          <h3>Wave {wave.wave} <span class="size">({wave.decisions.length} parallel)</span></h3>
          <ul>
            {#each wave.decisions as d (d.target_type + ":" + d.target_id)}
              <li>
                <div class="row">
                  <span class={actionClass(d.action)}>{d.action}</span>
                  <span class="title">{decisionTitle(d)}</span>
                  {#if d.predicted_cost_usd != null}
                    <span
                      class="cost"
                      title={`Median cost across ${d.predicted_cost_sample_size ?? "?"} past runs (same workspace + agent)`}
                    >≈ ${d.predicted_cost_usd.toFixed(2)}</span>
                  {/if}
                  {#if d.action === "run"}
                    <button
                      class="start"
                      onclick={() => startTask(d)}
                      disabled={starting !== null}
                      title="Launch this run"
                    >
                      {starting === d.target_id ? "…" : "▶"}
                    </button>
                  {/if}
                  <span class="score">{d.score}</span>
                </div>
                <div class="row sub">
                  {#if d.task_title}
                    <span class="parent">{d.task_title}</span>
                  {/if}
                  {#if d.repo}
                    <span class="repo">{d.repo}</span>
                  {/if}
                  {#if d.assigned_agent_id}
                    <span class="agent">→ {d.assigned_agent_id}</span>
                  {:else if d.candidate_agent_ids.length > 0}
                    <span class="agent muted">candidates: {d.candidate_agent_ids.join(", ")}</span>
                  {:else}
                    <span class="agent muted">no agent</span>
                  {/if}
                </div>
                {#if reasonsLine(d)}
                  <div class="reasons">{reasonsLine(d)}</div>
                {/if}
              </li>
            {/each}
          </ul>
        </article>
      {/each}
    </section>

    {#if plan.blocked.length > 0}
      <section class="other">
        <h3>Blocked <span class="size">({plan.blocked.length})</span></h3>
        <ul>
          {#each plan.blocked as d (d.target_type + ":" + d.target_id)}
            <li>
              <span class="title">{decisionTitle(d)}</span>
              <span class="reasons">{reasonsLine(d)}</span>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if plan.skipped.length > 0}
      <section class="other muted">
        <h3>Skipped <span class="size">({plan.skipped.length})</span></h3>
        <ul>
          {#each plan.skipped as d (d.target_type + ":" + d.target_id)}
            <li>
              <span class="title">{decisionTitle(d)}</span>
              <span class="reasons">{reasonsLine(d)}</span>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  {/if}
</aside>

<style>
  .panel {
    position: fixed;
    top: 0;
    right: 0;
    height: 100vh;
    width: min(420px, 90vw);
    background: var(--bg-surface);
    border-left: 1px solid var(--border-default);
    box-shadow: -4px 0 16px rgba(0, 0, 0, 0.08);
    z-index: 40;
    overflow-y: auto;
    padding: 0;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding: 14px 16px;
    border-bottom: 1px solid var(--border-default);
    position: sticky;
    top: 0;
    background: var(--bg-surface);
  }
  h2 {
    margin: 0;
    font-size: 16px;
  }
  .meta {
    margin: 4px 0 0;
    font-size: 12px;
    color: var(--text-muted);
  }
  .actions {
    display: flex;
    gap: 4px;
  }
  .actions button {
    background: var(--bg-hover);
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    padding: 4px 10px;
    cursor: pointer;
    font-size: 14px;
  }
  .error {
    margin: 12px 16px;
    padding: 8px 10px;
    background: var(--danger-bg);
    color: var(--danger);
    font-size: 12px;
    border-radius: 4px;
  }
  .info {
    margin: 12px 16px;
    padding: 8px 10px;
    background: var(--success-bg);
    color: var(--success);
    font-size: 12px;
    border-radius: 4px;
  }
  .start {
    background: var(--success);
    color: white;
    border: none;
    border-radius: 3px;
    padding: 1px 6px;
    cursor: pointer;
    font-size: 11px;
    flex-shrink: 0;
  }
  .start:hover { background: #036a3e; }
  .start:disabled { background: var(--text-subtle); cursor: wait; }
  .placeholder {
    padding: 32px 16px;
    text-align: center;
    color: var(--text-subtle);
    font-size: 14px;
  }
  .placeholder.small {
    padding: 12px 16px;
    font-size: 12px;
  }
  .waves, .other {
    padding: 8px 16px 4px;
  }
  .wave, .other {
    margin-bottom: 12px;
  }
  h3 {
    margin: 12px 0 6px;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-secondary);
  }
  .size {
    color: var(--text-subtle);
    text-transform: none;
    font-weight: 400;
  }
  ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  li {
    padding: 8px;
    border: 1px solid var(--border-default);
    border-radius: 6px;
    margin-bottom: 6px;
    font-size: 12px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .row.sub {
    color: var(--text-muted);
    margin-top: 4px;
    font-size: 11px;
    flex-wrap: wrap;
  }
  .title {
    flex: 1;
    font-weight: 500;
    color: var(--text-primary);
  }
  .score {
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
    font-size: 11px;
  }
  .cost {
    color: var(--text-secondary);
    background: var(--bg-hover);
    padding: 1px 6px;
    border-radius: 10px;
    font-size: 10px;
    font-variant-numeric: tabular-nums;
  }
  .chip {
    font-size: 10px;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: 3px;
    color: white;
    text-transform: uppercase;
  }
  .act-run    { background: var(--success); }
  .act-wait   { background: var(--warning); }
  .act-block  { background: var(--danger); }
  .act-skip   { background: var(--text-subtle); }
  .repo, .parent, .agent {
    background: var(--bg-hover);
    color: var(--text-body);
    padding: 1px 6px;
    border-radius: 3px;
  }
  .agent.muted { color: var(--text-subtle); background: transparent; padding-left: 0; }
  .reasons {
    margin-top: 4px;
    font-size: 11px;
    color: var(--text-subtle);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .other.muted { opacity: 0.7; }
  .other li { display: flex; gap: 8px; align-items: center; }

  .controls {
    padding: 12px 16px;
    border-bottom: 1px solid var(--border-default);
    background: var(--bg-muted);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .state-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: var(--text-muted);
  }
  .state-pill {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    padding: 2px 8px;
    border-radius: 10px;
    color: white;
  }
  .state-idle    { background: var(--text-subtle); }
  .state-running { background: var(--success); }
  .state-paused  { background: #f79009; }
  .state-stopping { background: var(--danger); }
  .control-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .control-row.settings { gap: 12px; font-size: 12px; color: var(--text-secondary); }
  .control-row button {
    padding: 4px 10px;
    border-radius: 4px;
    font-size: 13px;
    cursor: pointer;
    background: var(--bg-surface);
    border: 1px solid var(--border-strong);
  }
  .control-row button.play { background: var(--success); color: white; border-color: var(--success); }
  .control-row button.play:hover:not(:disabled) { background: #036a3e; }
  .control-row button.stop { background: var(--danger); color: white; border-color: var(--danger); }
  .control-row button.stop:hover:not(:disabled) { background: var(--danger); }
  .control-row button:disabled { opacity: 0.4; cursor: not-allowed; }
  .auto {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    cursor: pointer;
  }
  .slider {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    flex: 1;
  }
  .slider input[type="range"] {
    flex: 1;
  }
  .slider input[type="range"]:disabled {
    opacity: 0.4;
  }
  .slider-val {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    color: var(--text-primary);
    min-width: 16px;
    text-align: right;
  }
  .warn {
    background: var(--warning-bg);
    color: var(--warning);
    padding: 6px 8px;
    border-radius: 4px;
    font-size: 11px;
  }
</style>
