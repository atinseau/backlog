<script lang="ts">
  import { t } from "./i18n.svelte.js";
  import { focusTrap } from "./DialogShell.svelte";
  import { formatAgentLabel } from "./agent-label.js";
  import {
    applySplitProposal,
    fetchAgents,
    splitTask,
    suggestSplit,
    type AgentSummary,
    type ProposedTask,
    type SplitInput,
    type SplitResult,
  } from "./api.js";
  import type { TaskCard } from "./types.js";

  interface Props {
    workItem: TaskCard;
    availableRepos: string[];
    onClose: () => void;
    onSplit: (result: SplitResult) => void;
  }

  let { workItem, availableRepos, onClose, onSplit }: Props = $props();

  type ViewMode = "manual" | "ai-loading" | "ai-proposal";

  // svelte-ignore state_referenced_locally
  const initialRepos = workItem.repo_targets.length > 0
    ? workItem.repo_targets
    : availableRepos.slice(0, 1);

  let view = $state<ViewMode>("manual");
  // Initial-from-prop: split dialog opens with a sensible repo
  // selection and split-force-flag, then the user owns both. Prop
  // changes after open shouldn't reset the selections.
  // svelte-ignore state_referenced_locally
  let selectedRepos = $state<string[]>([...initialRepos]);
  let mode = $state<"parallel" | "serial">("parallel");
  let scopesByRepo = $state<Record<string, string>>({});
  let risk = $state<"low" | "medium" | "high">("medium");
  // svelte-ignore state_referenced_locally
  let force = $state(workItem.tasks.length > 0);
  let submitting = $state(false);
  let error = $state<string | null>(null);

  let aiTasks = $state<ProposedTask[]>([]);
  let aiRationale = $state<string>("");
  let aiModel = $state<string>("");
  let maxConcurrency = $state(3);
  let agents = $state<AgentSummary[]>([]);

  fetchAgents().then((list) => {
    agents = list.filter((a) => a.enabled);
  }).catch(() => { agents = []; });

  // Compute waves from depends_on_indices: a task lands in the first wave
  // where all its deps have been placed. Then assign agents round-robin
  // within each wave, capped at maxConcurrency. Tasks beyond the cap spill
  // into a follow-up wave.
  interface PlannedTask {
    index: number;
    task: ProposedTask;
    wave: number;
    agent: AgentSummary | null;
  }

  function buildPlan(tasks: ProposedTask[], cap: number, agentList: AgentSummary[]): PlannedTask[] {
    const placed = new Map<number, number>(); // task index → wave
    const result: PlannedTask[] = [];
    const remaining = tasks.map((_, i) => i);
    let wave = 0;
    let safety = 0;
    while (remaining.length > 0 && safety++ < 50) {
      const ready = remaining.filter((i) => {
        const deps = tasks[i]!.depends_on_indices;
        return deps.every((d) => placed.has(d));
      });
      if (ready.length === 0) break; // dependency cycle — bail
      // Spill into multiple waves if more ready than cap.
      let cursor = 0;
      while (cursor < ready.length) {
        const slice = ready.slice(cursor, cursor + cap);
        slice.forEach((idx, slot) => {
          const agent = agentList.length > 0 ? agentList[slot % agentList.length]! : null;
          placed.set(idx, wave);
          result.push({ index: idx, task: tasks[idx]!, wave, agent });
        });
        cursor += cap;
        wave += 1;
      }
      for (const idx of ready) {
        const at = remaining.indexOf(idx);
        if (at >= 0) remaining.splice(at, 1);
      }
    }
    return result;
  }

  const plan = $derived(buildPlan(aiTasks, maxConcurrency, agents));
  const planByWave = $derived.by(() => {
    const map = new Map<number, PlannedTask[]>();
    for (const p of plan) {
      const list = map.get(p.wave) ?? [];
      list.push(p);
      map.set(p.wave, list);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a - b)
      .map(([wave, tasks]) => ({ wave, tasks }));
  });

  function toggleRepo(repo: string) {
    if (selectedRepos.includes(repo)) {
      selectedRepos = selectedRepos.filter((r) => r !== repo);
    } else {
      selectedRepos = [...selectedRepos, repo];
    }
  }

  function parseScopes(raw: string): string[] {
    return raw
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  function joinScopes(scopes: string[]): string {
    return scopes.join("\n");
  }

  async function requestSuggestion() {
    error = null;
    view = "ai-loading";
    const result = await suggestSplit(workItem.id);
    if (result.ok) {
      aiTasks = result.proposal.tasks.map((task) => ({ ...task }));
      aiRationale = result.proposal.rationale;
      aiModel = result.proposal.model;
      view = "ai-proposal";
    } else {
      error = result.detail;
      view = "manual";
    }
  }

  async function handleManualSubmit(event: Event) {
    event.preventDefault();
    error = null;
    if (selectedRepos.length === 0) {
      error = t("split_dialog.error.no_repository");
      return;
    }
    submitting = true;
    try {
      const scope_by_repo: Record<string, string[]> = {};
      for (const repo of selectedRepos) {
        const raw = scopesByRepo[repo] ?? "";
        const scopes = parseScopes(raw);
        if (scopes.length > 0) scope_by_repo[repo] = scopes;
      }
      const input: SplitInput = {
        repos: selectedRepos,
        mode,
        risk,
        force,
      };
      if (Object.keys(scope_by_repo).length > 0) input.scope_by_repo = scope_by_repo;
      const result = await splitTask(workItem.id, input);
      onSplit(result);
      onClose();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      submitting = false;
    }
  }

  async function handleApplyProposal() {
    error = null;
    submitting = true;
    try {
      const result = await applySplitProposal(workItem.id, aiTasks, force);
      onSplit(result);
      onClose();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      submitting = false;
    }
  }

  function removeTask(index: number) {
    aiTasks = aiTasks
      .filter((_, i) => i !== index)
      .map((task) => ({
        ...task,
        depends_on_indices: task.depends_on_indices
          .filter((dep) => dep !== index)
          .map((dep) => (dep > index ? dep - 1 : dep)),
      }));
  }

  function setTaskScopes(index: number, raw: string) {
    aiTasks = aiTasks.map((task, i) =>
      i === index ? { ...task, scopes: parseScopes(raw) } : task,
    );
  }
</script>

<div class="backdrop" onclick={onClose} role="presentation">
  <div use:focusTrap class="dialog" role="dialog" aria-modal="true" aria-label={t("split_dialog.title", { taskId: workItem.id })} onclick={(e) => e.stopPropagation()} tabindex={-1} onkeydown={(e) => { if (e.key === "Escape") onClose(); }}>
    <header>
      <div>
        <h2>{t("split_dialog.title", { taskId: workItem.id })}</h2>
        <p class="meta">{workItem.title}</p>
      </div>
      <button class="close" onclick={onClose} aria-label={t("common.close")}>×</button>
    </header>

    <nav class="tabs">
      <button
        class:active={view === "manual"}
        onclick={() => (view = "manual")}
        type="button"
      >{t("split_dialog.tab.manual")}</button>
      <button
        class:active={view === "ai-loading" || view === "ai-proposal"}
        onclick={requestSuggestion}
        disabled={view === "ai-loading"}
        type="button"
      >🤖 {t("split_dialog.tab.ai_suggest")}</button>
    </nav>

    {#if view === "ai-loading"}
      <div class="placeholder">{t("split_dialog.ai.asking")}</div>
    {/if}

    {#if view === "ai-proposal" && aiTasks.length > 0}
      <div class="proposal">
        <p class="rationale">
          <span class="model">{aiModel}</span>
          {aiRationale}
        </p>

        <div class="concurrency-row">
          <label class="concurrency">
            <span class="label">{t("split_dialog.max_concurrency")}</span>
            <input
              type="range"
              min="1"
              max={Math.max(1, aiTasks.length)}
              bind:value={maxConcurrency}
            />
            <span class="value">{maxConcurrency}</span>
          </label>
          <span class="muted small">
            {t("split_dialog.agents_available", { count: agents.length })}
          </span>
        </div>

        <div class="plan">
          <h4>{t("split_dialog.plan_title")}</h4>
          <div class="waves">
            {#each planByWave as { wave, tasks } (wave)}
              <div class="wave">
                <div class="wave-label">
                  {t("split_dialog.wave_label", { wave: wave + 1 })}
                  <span class="wave-mode">{tasks.length > 1 ? t("split_dialog.parallel") : t("split_dialog.serial")}</span>
                </div>
                <div class="wave-tasks">
                  {#each tasks as p (p.index)}
                    <div class="plan-task">
                      <div class="plan-task-head">
                        <span class="plan-idx">#{p.index + 1}</span>
                        <span class="plan-title">{p.task.title}</span>
                      </div>
                      <div class="plan-task-meta">
                        <!-- Risk used to be a 4px coloured border-left.
                             DESIGN.md reserves the coloured side rail for
                             the card's priority, and colour alone never
                             carries information here: it is a labelled
                             badge now, readable and translatable. -->
                        <span class="plan-risk risk-{p.task.risk}">{t(`common.risk.${p.task.risk}`)}</span>
                        <span class="plan-repo">{p.task.repo}</span>
                        {#if p.agent}
                          <span class="plan-agent">→ {formatAgentLabel(p.agent).withContext}</span>
                        {:else}
                          <span class="plan-agent unknown">{t("split_dialog.no_agent")}</span>
                        {/if}
                      </div>
                    </div>
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        </div>

        <ul class="tasks">
          {#each aiTasks as task, index (index)}
            <li>
              <div class="task-head">
                <span class="idx">#{index + 1}</span>
                <input
                  type="text"
                  bind:value={aiTasks[index].title}
                  placeholder={t("split_dialog.placeholder.subtask_title")}
                />
                <select bind:value={aiTasks[index].risk} aria-label={t("split_dialog.field.risk")}>
                  <option value="low">{t("common.risk.low")}</option>
                  <option value="medium">{t("common.risk.medium")}</option>
                  <option value="high">{t("common.risk.high")}</option>
                </select>
                <select bind:value={aiTasks[index].repo} aria-label={t("split_dialog.field.repository")}>
                  {#each availableRepos as repo (repo)}
                    <option value={repo}>{repo}</option>
                  {/each}
                </select>
                <button class="remove" onclick={() => removeTask(index)} title={t("common.remove")} aria-label={t("common.remove")} type="button">×</button>
              </div>
              <textarea
                rows="2"
                value={joinScopes(task.scopes)}
                oninput={(e) => setTaskScopes(index, (e.target as HTMLTextAreaElement).value)}
                placeholder={t("split_dialog.placeholder.scopes_lines")}
              ></textarea>
              {#if task.depends_on_indices.length > 0}
                <p class="deps">{t("split_dialog.depends_on", { list: task.depends_on_indices.map((i) => `#${i + 1}`).join(", ") })}</p>
              {/if}
            </li>
          {/each}
        </ul>

        {#if workItem.tasks.length > 0}
          <label class="force">
            <input type="checkbox" bind:checked={force} />
            {t("split_dialog.force_append", { count: workItem.tasks.length })}
          </label>
        {/if}

        {#if error}
          <div class="error">{error}</div>
        {/if}

        <footer>
          <button type="button" onclick={onClose}>{t("split_dialog.button.cancel")}</button>
          <button type="button" onclick={requestSuggestion} disabled={submitting}>↻ {t("split_dialog.button.reask")}</button>
          <button type="button" class="primary" onclick={handleApplyProposal} disabled={submitting || aiTasks.length === 0}>
            {submitting ? t("split_dialog.button.creating") : t("split_dialog.button.apply_count", { count: aiTasks.length })}
          </button>
        </footer>
      </div>
    {/if}

    {#if view === "manual"}
      <form onsubmit={handleManualSubmit}>
        <fieldset>
          <legend>{t("split_dialog.field.repos")}</legend>
          {#if availableRepos.length === 0}
            <p class="hint">{t("split_dialog.repositories.empty")}</p>
          {:else}
            <ul class="repos">
              {#each availableRepos as repo (repo)}
                <li>
                  <label>
                    <input
                      type="checkbox"
                      checked={selectedRepos.includes(repo)}
                      onchange={() => toggleRepo(repo)}
                    />
                    <span>{repo}</span>
                  </label>
                  {#if selectedRepos.includes(repo)}
                    <textarea
                      placeholder={t("split_dialog.placeholder.scopes_globs")}
                      rows="2"
                      bind:value={scopesByRepo[repo]}
                    ></textarea>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        </fieldset>

        <div class="row">
          <fieldset class="inline">
            <legend>{t("split_dialog.field.mode")}</legend>
            <label><input type="radio" bind:group={mode} value="parallel" /> {t("split_dialog.mode.parallel")}</label>
            <label><input type="radio" bind:group={mode} value="serial" /> {t("split_dialog.mode.serial")}</label>
          </fieldset>

          <label class="risk">
            {t("split_dialog.field.risk")}
            <select bind:value={risk}>
              <option value="low">{t("common.risk.low")}</option>
              <option value="medium">{t("common.risk.medium")}</option>
              <option value="high">{t("common.risk.high")}</option>
            </select>
          </label>
        </div>

        {#if workItem.tasks.length > 0}
          <label class="force">
            <input type="checkbox" bind:checked={force} />
            {t("split_dialog.force_append", { count: workItem.tasks.length })}
          </label>
        {/if}

        {#if error}
          <div class="error">{error}</div>
        {/if}

        <footer>
          <button type="button" onclick={onClose}>{t("split_dialog.button.cancel")}</button>
          <button type="submit" class="primary" disabled={submitting}>
            {submitting ? t("split_dialog.button.splitting") : t("split_dialog.button.create_count", { count: selectedRepos.length })}
          </button>
        </footer>
      </form>
    {/if}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: var(--backdrop);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 50;
  }
  .dialog {
    background: var(--bg-surface);
    border-radius: 8px;
    width: min(560px, 92vw);
    max-height: 92vh;
    max-height: 92dvh;
    overflow-y: auto;
    box-shadow: var(--shadow-modal);
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
    z-index: 1;
  }
  h2 { margin: 0; font-size: 16px; }
  .meta { margin: 4px 0 0; font-size: 12px; color: var(--text-muted); }
  .close {
    background: none;
    border: none;
    font-size: 18px;
    cursor: pointer;
    color: var(--text-muted);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: var(--tap-size);
    min-height: var(--tap-size);
    border-radius: 4px;
  }
  button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .tabs {
    display: flex;
    border-bottom: 1px solid var(--border-default);
    padding: 0 12px;
  }
  .tabs button {
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    padding: 10px 12px;
    cursor: pointer;
    font-size: 13px;
    color: var(--text-muted);
    min-height: var(--tap-size);
  }
  .tabs button.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
    font-weight: 500;
  }
  .tabs button:hover { color: var(--text-primary); }
  .tabs button:disabled { color: var(--text-subtle); cursor: wait; }

  .placeholder {
    padding: 32px 16px;
    text-align: center;
    color: var(--text-muted);
    font-size: 14px;
  }

  .proposal {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .rationale {
    margin: 0;
    padding: 8px 10px;
    background: var(--accent-bg);
    color: var(--accent-text);
    border-radius: 4px;
    font-size: 12px;
    line-height: 1.4;
  }
  .model {
    background: var(--bg-hover);
    padding: 0 4px;
    border-radius: 3px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px;
    margin-right: 4px;
  }
  .tasks {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .tasks li {
    border: 1px solid var(--border-default);
    border-radius: 6px;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .task-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .idx {
    font-size: 11px;
    color: var(--text-muted);
    background: var(--bg-hover);
    padding: 2px 6px;
    border-radius: 3px;
    flex-shrink: 0;
  }
  .task-head input[type="text"] {
    flex: 1;
    min-width: 140px;
    font: inherit;
    padding: 4px 6px;
    border: 1px solid var(--border-field);
    border-radius: 4px;
    font-size: 13px;
  }
  .task-head select {
    font: inherit;
    padding: 4px 6px;
    border: 1px solid var(--border-field);
    border-radius: 4px;
    font-size: 12px;
  }
  /* A bare × glyph on an otherwise chromeless button: --text-subtle is
     the legitimate non-text 3:1 floor here, not an ink downgrade. */
  .remove {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-subtle);
    font-size: 16px;
    padding: 0 4px;
    min-width: var(--tap-size);
    min-height: var(--tap-size);
  }
  .remove:hover { color: var(--danger); }
  .tasks textarea {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    padding: 6px 8px;
    border: 1px solid var(--border-field);
    border-radius: 4px;
    resize: vertical;
  }
  textarea::placeholder,
  input::placeholder { color: var(--text-muted); }
  .deps {
    margin: 0;
    font-size: 11px;
    color: var(--warning);
  }

  form {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  fieldset {
    border: 1px solid var(--border-default);
    border-radius: 6px;
    padding: 8px 12px;
  }
  legend {
    padding: 0 4px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-secondary);
  }
  .repos {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .repos li {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .repos label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: var(--text-primary);
  }
  .repos textarea {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    padding: 6px 8px;
    border: 1px solid var(--border-field);
    border-radius: 4px;
    resize: vertical;
    margin-left: 22px;
  }
  .row {
    display: flex;
    gap: 12px;
    align-items: stretch;
  }
  fieldset.inline {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 12px;
  }
  fieldset.inline label {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    margin: 0;
  }
  .risk {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    color: var(--text-body);
  }
  .risk select {
    padding: 6px 8px;
    border: 1px solid var(--border-field);
    border-radius: 4px;
    font: inherit;
  }
  .force {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--text-body);
  }
  .hint {
    margin: 0;
    color: var(--text-muted);
    font-size: 12px;
  }
  .error {
    background: var(--danger-bg);
    color: var(--danger);
    padding: 8px 10px;
    border-radius: 4px;
    font-size: 12px;
  }
  footer {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
  }
  footer button {
    background: var(--bg-hover);
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    padding: 6px 14px;
    cursor: pointer;
    min-height: var(--tap-size);
  }
  footer button.primary {
    background: var(--accent);
    color: var(--accent-on);
    border-color: var(--accent);
  }
  /* Neutral disabled fill pair — --text-subtle is never a background. */
  footer button.primary:disabled {
    background: var(--text-muted);
    border-color: var(--text-muted);
    color: var(--text-inverse);
    cursor: wait;
  }
  .concurrency-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin: 12px 0;
    padding: 10px 12px;
    background: var(--bg-muted);
    border-radius: 6px;
    border: 1px solid var(--border-default);
  }
  .concurrency {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 1;
    font-size: 13px;
  }
  .concurrency .label { color: var(--text-body); font-weight: 500; }
  .concurrency input[type="range"] { flex: 1; max-width: 200px; }
  .concurrency .value {
    background: var(--accent);
    color: var(--accent-on);
    padding: 2px 10px;
    border-radius: 999px;
    font-weight: 600;
    font-size: 12px;
    min-width: 32px;
    text-align: center;
  }
  .muted { color: var(--text-muted); }
  .small { font-size: 11px; }
  .plan {
    margin: 12px 0;
  }
  .plan h4 {
    margin: 0 0 8px;
    font-size: 13px;
    color: var(--text-body);
    font-weight: 600;
  }
  .waves {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  /* Dropped a 4px accent border-left: the "WAVE n" label already names
     the group, and DESIGN.md keeps the coloured side rail for the
     card's priority alone. */
  .wave {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px 12px;
    background: var(--bg-surface);
    border: 1px solid var(--border-default);
    border-radius: 6px;
  }
  .wave-label {
    font-size: 11px;
    color: var(--text-secondary);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .wave-mode {
    background: var(--accent-bg);
    color: var(--accent-text);
    font-weight: 500;
    text-transform: lowercase;
    padding: 1px 8px;
    border-radius: 999px;
    /* 10px is caps-only in this system; lowercase copy sits at 11px. */
    font-size: 11px;
    letter-spacing: 0;
  }
  .wave-tasks {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 8px;
  }
  .plan-task {
    background: var(--bg-muted);
    border: 1px solid var(--border-default);
    border-radius: 4px;
    padding: 8px 10px;
  }
  /* Risk now rides a labelled badge in .plan-task-meta instead of three
     coloured left rails, using the same pale-fill / saturated-ink pair
     the rest of the board uses for status. */
  .plan-risk {
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
  }
  .plan-risk.risk-low { background: var(--success-bg); color: var(--success); }
  .plan-risk.risk-medium { background: var(--warning-bg); color: var(--warning); }
  .plan-risk.risk-high { background: var(--danger-bg); color: var(--danger); }
  .plan-task-head { display: flex; gap: 8px; align-items: baseline; margin-bottom: 4px; }
  .plan-idx {
    background: var(--bg-hover);
    color: var(--text-secondary);
    border-radius: 4px;
    padding: 1px 6px;
    font-size: 11px;
    font-weight: 600;
  }
  .plan-title { font-size: 12px; color: var(--text-primary); font-weight: 500; line-height: 1.3; }
  .plan-task-meta { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; font-size: 11px; }
  .plan-repo {
    background: var(--accent-bg);
    color: var(--accent-text);
    padding: 1px 6px;
    border-radius: 3px;
  }
  .plan-agent {
    color: var(--text-body);
    font-family: ui-monospace, monospace;
  }
  .plan-agent.unknown { color: var(--warning); font-style: italic; }
</style>
