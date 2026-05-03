<script lang="ts">
  import { fetchUsage, type UsageResponse, type UsageTotals } from "./api.js";
  import { formatAgentLabel } from "./agent-label.js";
  import { t } from "./i18n.svelte.js";

  interface Props {
    onClose: () => void;
    embedded?: boolean;
  }

  let { onClose, embedded = false }: Props = $props();

  type Period = UsageResponse["period"];
  type Bucket = UsageResponse["bucket"];

  let period = $state<Period>("30d");
  let bucket = $state<Bucket>("day");
  let usage = $state<UsageResponse | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let requestSeq = 0;

  const totalTokens = $derived(usage ? tokensFor(usage.totals) : 0);
  const maxTimelineTokens = $derived(Math.max(0, ...(usage?.timeline.map((point) => point.total_tokens) ?? [])));
  const maxModelTokens = $derived(Math.max(0, ...(usage?.by_model.map((model) => model.total_tokens) ?? [])));

  function defaultBucket(next: Period): Bucket {
    if (next === "7d" || next === "30d") return "day";
    if (next === "90d") return "week";
    return "month";
  }

  function selectPeriod(next: Period) {
    period = next;
    bucket = defaultBucket(next);
  }

  function tokensFor(totals: UsageTotals): number {
    return totals.input_tokens
      + totals.output_tokens
      + totals.cache_read_input_tokens
      + totals.cache_creation_input_tokens;
  }

  function formatTokens(value: number): string {
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 1 : 2)}M`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}k`;
    return String(value);
  }

  function formatCost(value: number): string {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: value < 1 ? 4 : 2,
      maximumFractionDigits: value < 1 ? 4 : 2,
    }).format(value);
  }

  function percent(value: number, max: number): number {
    if (max <= 0 || value <= 0) return 0;
    return Math.max(4, Math.round((value / max) * 100));
  }

  function providerForModel(model: string): string {
    const normalized = model.toLowerCase();
    if (normalized.startsWith("claude-") || normalized === "sonnet" || normalized === "opus" || normalized === "haiku") return "claude";
    if (normalized.startsWith("gpt-") || normalized.startsWith("o")) return "codex";
    if (normalized.startsWith("gemini-")) return "gemini";
    return "custom";
  }

  function modelLabel(model: string): string {
    return formatAgentLabel({
      provider: providerForModel(model),
      model,
      display_name: null,
    }).withContext;
  }

  function shortBucketLabel(value: string): string {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value.slice(5);
    if (/^\d{4}-\d{2}$/.test(value)) return value.slice(2);
    return value.replace(/^(\d{4})-W/, "$1 W");
  }

  function modelList(models: string[]): string {
    return models.map(modelLabel).join(", ");
  }

  function load() {
    const seq = ++requestSeq;
    loading = true;
    fetchUsage({ period, bucket })
      .then((next) => {
        if (seq !== requestSeq) return;
        usage = next;
        error = null;
      })
      .catch((err) => {
        if (seq !== requestSeq) return;
        error = err instanceof Error ? err.message : String(err);
      })
      .finally(() => {
        if (seq === requestSeq) loading = false;
      });
  }

  $effect(() => {
    period;
    bucket;
    load();
  });
</script>

{#snippet body()}
  <section class="usage-view">
    <header class="usage-header">
      <div>
        <h2>{t("usage.title")}</h2>
        {#if usage}
          <p>{t("usage.generated_at", { date: new Date(usage.generated_at).toLocaleString() })}</p>
        {/if}
      </div>
      <div class="header-actions">
        <div class="periods" role="group" aria-label={t("usage.period")}>
          {#each ["7d", "30d", "90d", "12m", "all"] as item}
            <button
              type="button"
              class:active={period === item}
              onclick={() => selectPeriod(item as Period)}
            >
              {t(`usage.period.${item}`)}
            </button>
          {/each}
        </div>
        <select value={bucket} onchange={(e) => (bucket = (e.currentTarget as HTMLSelectElement).value as Bucket)}>
          <option value="day">{t("usage.bucket.day")}</option>
          <option value="week">{t("usage.bucket.week")}</option>
          <option value="month">{t("usage.bucket.month")}</option>
        </select>
        <button type="button" class="refresh" onclick={load}>{t("usage.refresh")}</button>
        {#if !embedded}
          <button type="button" class="close" onclick={onClose}>{t("common.close")}</button>
        {/if}
      </div>
    </header>

    {#if error}
      <div class="error">{error}</div>
    {/if}

    {#if loading && !usage}
      <div class="loading">{t("usage.loading")}</div>
    {:else if usage}
      <div class="metric-grid">
        <div class="metric">
          <span>{t("usage.metric.cost")}</span>
          <strong>{formatCost(usage.totals.cost_usd)}</strong>
          <small>{t("usage.metric.estimated")}</small>
        </div>
        <div class="metric">
          <span>{t("usage.metric.tokens")}</span>
          <strong>{formatTokens(totalTokens)}</strong>
          <small>{t("usage.metric.total_tokens")}</small>
        </div>
        <div class="metric">
          <span>{t("usage.metric.input_output")}</span>
          <strong>{formatTokens(usage.totals.input_tokens)} / {formatTokens(usage.totals.output_tokens)}</strong>
          <small>{t("usage.metric.input_output_hint")}</small>
        </div>
        <div class="metric">
          <span>{t("usage.metric.cache")}</span>
          <strong>{formatTokens(usage.totals.cache_read_input_tokens + usage.totals.cache_creation_input_tokens)}</strong>
          <small>{t("usage.metric.cache_hint")}</small>
        </div>
        <div class="metric">
          <span>{t("usage.metric.runs")}</span>
          <strong>{usage.runs.length}</strong>
          <small>{t("usage.metric.runs_hint")}</small>
        </div>
        <div class="metric">
          <span>{t("usage.metric.unknown")}</span>
          <strong>{formatTokens(usage.totals.unknown_model_tokens)}</strong>
          <small>{t("usage.metric.unknown_hint")}</small>
        </div>
      </div>

      <div class="usage-grid">
        <section class="panel timeline-panel">
          <div class="panel-title">
            <h3>{t("usage.timeline.title")}</h3>
            <span>{t(`usage.bucket.${usage.bucket}`)}</span>
          </div>
          {#if usage.timeline.length === 0}
            <div class="empty">{t("usage.empty")}</div>
          {:else}
            <div class="timeline-chart" aria-label={t("usage.timeline.title")}>
              {#each usage.timeline as point (point.bucket)}
                <div class="timeline-bar" title={`${point.bucket} · ${formatTokens(point.total_tokens)} · ${formatCost(point.totals.cost_usd)}`}>
                  <div class="bar-fill" style={`height: ${percent(point.total_tokens, maxTimelineTokens)}%`}></div>
                  <span>{shortBucketLabel(point.bucket)}</span>
                </div>
              {/each}
            </div>
          {/if}
        </section>

        <section class="panel model-panel">
          <div class="panel-title">
            <h3>{t("usage.models.title")}</h3>
            <span>{usage.by_model.length}</span>
          </div>
          {#if usage.by_model.length === 0}
            <div class="empty">{t("usage.empty")}</div>
          {:else}
            <div class="model-bars">
              {#each usage.by_model as model (model.model)}
                <div class="model-row">
                  <div class="model-head">
                    <strong>{modelLabel(model.model)}</strong>
                    <span>{formatCost(model.totals.cost_usd)}</span>
                  </div>
                  <div class="progress"><span style={`width: ${percent(model.total_tokens, maxModelTokens)}%`}></span></div>
                  <div class="model-meta">
                    <span>{formatTokens(model.total_tokens)}</span>
                    <span>{t("usage.table.input")}: {formatTokens(model.totals.input_tokens)}</span>
                    <span>{t("usage.table.output")}: {formatTokens(model.totals.output_tokens)}</span>
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </section>
      </div>

      <section class="panel table-panel">
        <div class="panel-title">
          <h3>{t("usage.table.models")}</h3>
        </div>
        <table>
          <thead>
            <tr>
              <th>{t("usage.table.model")}</th>
              <th>{t("usage.table.cost")}</th>
              <th>{t("usage.table.input")}</th>
              <th>{t("usage.table.output")}</th>
              <th>{t("usage.table.cache_read")}</th>
              <th>{t("usage.table.cache_write")}</th>
              <th>{t("usage.table.total")}</th>
            </tr>
          </thead>
          <tbody>
            {#each usage.by_model as model (model.model)}
              <tr>
                <td>{modelLabel(model.model)}</td>
                <td>{formatCost(model.totals.cost_usd)}</td>
                <td>{formatTokens(model.totals.input_tokens)}</td>
                <td>{formatTokens(model.totals.output_tokens)}</td>
                <td>{formatTokens(model.totals.cache_read_input_tokens)}</td>
                <td>{formatTokens(model.totals.cache_creation_input_tokens)}</td>
                <td>{formatTokens(model.total_tokens)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </section>

      <section class="panel table-panel">
        <div class="panel-title">
          <h3>{t("usage.table.runs")}</h3>
          <span>{usage.runs.length}</span>
        </div>
        {#if usage.runs.length === 0}
          <div class="empty">{t("usage.empty")}</div>
        {:else}
          <table>
            <thead>
              <tr>
                <th>{t("usage.table.run")}</th>
                <th>{t("usage.table.models")}</th>
                <th>{t("usage.table.cost")}</th>
                <th>{t("usage.table.total")}</th>
              </tr>
            </thead>
            <tbody>
              {#each usage.runs as run (run.run_id)}
                <tr>
                  <td><code>{run.run_id}</code></td>
                  <td>{modelList(run.models)}</td>
                  <td>{formatCost(run.totals.cost_usd)}</td>
                  <td>{formatTokens(run.total_tokens)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </section>
    {/if}
  </section>
{/snippet}

{#if embedded}
  {@render body()}
{:else}
  <div
    class="backdrop"
    onclick={onClose}
    onkeydown={(e) => { if (e.key === "Escape") onClose(); }}
    role="presentation"
  >
    <div
      class="modal"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => { if (e.key === "Escape") onClose(); }}
      role="dialog"
      aria-modal="true"
      tabindex="-1"
    >
      {@render body()}
    </div>
  </div>
{/if}

<style>
  .usage-view {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 18px;
    overflow: auto;
    background: var(--bg-app);
    color: var(--text-primary);
  }
  .usage-header,
  .panel-title,
  .header-actions,
  .periods {
    display: flex;
    align-items: center;
  }
  .usage-header {
    justify-content: space-between;
    gap: 16px;
  }
  h2,
  h3 {
    margin: 0;
    letter-spacing: 0;
  }
  h2 { font-size: 18px; }
  h3 { font-size: 13px; }
  .usage-header p {
    margin: 4px 0 0;
    color: var(--text-muted);
    font-size: 12px;
  }
  .header-actions {
    gap: 8px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }
  .periods {
    background: var(--bg-muted);
    border: 1px solid var(--border-default);
    border-radius: 5px;
    padding: 2px;
  }
  .periods button,
  .refresh,
  .close,
  select {
    height: 28px;
    border: 1px solid var(--border-default);
    background: var(--bg-surface);
    color: var(--text-primary);
    border-radius: 4px;
    padding: 0 9px;
    font: inherit;
    font-size: 12px;
  }
  .periods button {
    border: none;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
  }
  .periods button.active {
    background: var(--bg-elevated);
    color: var(--text-primary);
    box-shadow: inset 0 0 0 1px var(--border-default);
  }
  .refresh,
  .close,
  select {
    cursor: pointer;
  }
  .metric-grid {
    display: grid;
    grid-template-columns: repeat(6, minmax(120px, 1fr));
    gap: 10px;
  }
  .metric,
  .panel {
    border: 1px solid var(--border-default);
    background: var(--bg-surface);
    border-radius: 6px;
  }
  .metric {
    min-height: 74px;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 3px;
  }
  .metric span,
  .metric small,
  .panel-title span,
  .model-meta,
  th {
    color: var(--text-muted);
  }
  .metric span,
  .metric small,
  .panel-title span {
    font-size: 11px;
  }
  .metric strong {
    font-size: 20px;
    line-height: 1.1;
  }
  .usage-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.2fr) minmax(320px, 0.8fr);
    gap: 12px;
    min-height: 260px;
  }
  .panel {
    min-width: 0;
    padding: 12px;
  }
  .panel-title {
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
  }
  .timeline-chart {
    height: 210px;
    min-width: 0;
    display: flex;
    align-items: end;
    gap: 5px;
    border-bottom: 1px solid var(--border-default);
    padding-top: 8px;
    overflow-x: auto;
  }
  .timeline-bar {
    min-width: 26px;
    flex: 1 0 26px;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    justify-content: flex-end;
    gap: 6px;
  }
  .bar-fill {
    min-height: 0;
    border-radius: 3px 3px 0 0;
    background: linear-gradient(180deg, var(--accent), color-mix(in srgb, var(--accent) 65%, var(--success)));
  }
  .timeline-bar span {
    height: 18px;
    font-size: 10px;
    color: var(--text-muted);
    text-align: center;
    white-space: nowrap;
  }
  .model-bars {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .model-row {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .model-head,
  .model-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .model-head strong {
    font-size: 12px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .model-head span {
    font-size: 12px;
    color: var(--text-secondary);
    flex-shrink: 0;
  }
  .progress {
    height: 7px;
    background: var(--bg-muted);
    border-radius: 999px;
    overflow: hidden;
  }
  .progress span {
    display: block;
    height: 100%;
    background: var(--accent);
    border-radius: inherit;
  }
  .model-meta {
    justify-content: flex-start;
    flex-wrap: wrap;
    font-size: 11px;
  }
  .table-panel {
    overflow: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  th,
  td {
    padding: 8px 10px;
    border-bottom: 1px solid var(--border-subtle);
    text-align: left;
    vertical-align: top;
  }
  th {
    font-weight: 600;
    white-space: nowrap;
  }
  td {
    color: var(--text-body);
  }
  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px;
    color: var(--text-secondary);
  }
  .empty,
  .loading,
  .error {
    padding: 18px;
    color: var(--text-muted);
    font-size: 13px;
  }
  .error {
    border: 1px solid var(--warning);
    background: var(--warning-bg);
    color: var(--warning);
    border-radius: 6px;
  }
  .backdrop {
    position: fixed;
    inset: 0;
    background: var(--backdrop);
    z-index: 120;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .modal {
    width: min(1180px, calc(100vw - 40px));
    height: min(820px, calc(100vh - 40px));
    background: var(--bg-app);
    border: 1px solid var(--border-default);
    border-radius: 8px;
    overflow: hidden;
    box-shadow: var(--shadow-modal);
  }

  @media (max-width: 1100px) {
    .metric-grid {
      grid-template-columns: repeat(3, minmax(120px, 1fr));
    }
    .usage-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
