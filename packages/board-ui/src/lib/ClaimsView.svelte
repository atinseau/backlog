<script lang="ts">
  import { onDestroy } from "svelte";
  import {
    approveRun,
    archiveClaim,
    cancelRun,
    discardRun,
    fetchAllClaims,
    fetchRuns,
    type EnrichedRun,
  } from "./api.js";
  import { formatAgentLabel } from "./agent-label.js";
  import { t } from "./i18n.svelte.js";
  import { formatDuration, formatRemaining, useTimer } from "./timer.svelte.js";
  import type { ClaimRecord } from "./types.js";

  interface Props {
    onClose: () => void;
    onChanged?: () => void;
    embedded?: boolean;
  }

  type Tab = "all" | "active" | "archived";
  type Selection = { kind: "run"; id: string } | { kind: "claim"; id: string };

  let { onClose, onChanged, embedded = false }: Props = $props();

  const timer = useTimer();
  onDestroy(() => timer.release());

  let runs = $state<EnrichedRun[]>([]);
  let activeClaims = $state<ClaimRecord[]>([]);
  let archivedClaims = $state<ClaimRecord[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let busyAction = $state<string | null>(null);
  let tab = $state<Tab>("all");
  let selection = $state<Selection | null>(null);

  const visibleRuns = $derived.by(() => runsFor(tab, runs));
  const linkedClaimIds = $derived.by(() => new Set(runs.flatMap((run) => run.claim_ids)));
  const allLooseClaims = $derived.by(() =>
    [...activeClaims, ...archivedClaims].filter((claim) => !linkedClaimIds.has(claim.id)),
  );
  const activeLooseClaims = $derived.by(() => activeClaims.filter((claim) => !linkedClaimIds.has(claim.id)));
  const archivedLooseClaims = $derived.by(() => archivedClaims.filter((claim) => !linkedClaimIds.has(claim.id)));
  const looseClaims = $derived.by(() => claimsFor(tab).filter((claim) => !linkedClaimIds.has(claim.id)));
  const selectedRun = $derived.by(() => {
    const current = selection;
    if (current?.kind !== "run") return null;
    return runs.find((run) => run.id === current.id) ?? null;
  });
  const selectedClaim = $derived.by(() => {
    const current = selection;
    if (current?.kind !== "claim") return null;
    return [...activeClaims, ...archivedClaims].find((claim) => claim.id === current.id) ?? null;
  });

  function runsFor(next: Tab, source = runs): EnrichedRun[] {
    if (next === "active") return source.filter((run) => run.active);
    if (next === "archived") return source.filter((run) => !run.active);
    return source;
  }

  function claimsFor(next: Tab): ClaimRecord[] {
    if (next === "active") return activeClaims;
    if (next === "archived") return archivedClaims;
    return [...activeClaims, ...archivedClaims];
  }

  function firstSelection(next: Tab = tab, source = runs): Selection | null {
    const firstRun = runsFor(next, source)[0];
    if (firstRun) return { kind: "run", id: firstRun.id };
    const linked = new Set(source.flatMap((run) => run.claim_ids));
    const firstClaim = claimsFor(next).find((claim) => !linked.has(claim.id));
    return firstClaim ? { kind: "claim", id: firstClaim.id } : null;
  }

  function selectionVisible(next: Tab, current: Selection | null): boolean {
    if (!current) return false;
    if (current.kind === "run") return runsFor(next).some((run) => run.id === current.id);
    return claimsFor(next).some((claim) => claim.id === current.id && !linkedClaimIds.has(claim.id));
  }

  function withTimeout<T>(promise: Promise<T>, label: string, ms = 12_000): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<T>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} : délai dépassé`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  }

  function errorMessage(prefix: string, result: PromiseRejectedResult): string {
    const reason = result.reason;
    return `${prefix}: ${reason instanceof Error ? reason.message : String(reason)}`;
  }

  async function load() {
    loading = true;
    const [runsResult, activeResult, archivedResult] = await Promise.allSettled([
      withTimeout(fetchRuns({ scope: "all" }), "Runs"),
      withTimeout(fetchAllClaims({}), "Protections actives"),
      withTimeout(fetchAllClaims({ archived: true }), "Protections archivées"),
    ]);
    const errors: string[] = [];
    if (runsResult.status === "fulfilled") {
      runs = runsResult.value;
    } else {
      errors.push(errorMessage("Runs", runsResult));
    }
    if (activeResult.status === "fulfilled") {
      activeClaims = activeResult.value;
    } else {
      errors.push(errorMessage("Protections actives", activeResult));
    }
    if (archivedResult.status === "fulfilled") {
      archivedClaims = archivedResult.value;
    } else {
      errors.push(errorMessage("Protections archivées", archivedResult));
    }
    if (!selection || !selectionVisible(tab, selection)) selection = firstSelection(tab, runs);
    error = errors.length > 0 ? errors.join("\n") : null;
    loading = false;
  }

  function switchTab(next: Tab) {
    tab = next;
    if (!selectionVisible(next, selection)) selection = firstSelection(next);
  }

  function ownerLabel(run: EnrichedRun): string {
    const label = formatAgentLabel({
      display_name: run.owner.display_name,
      provider: run.owner.provider,
      model: run.owner.model ?? null,
    }).withContext;
    return run.owner.profile ? `${label} · ${run.owner.profile}` : label;
  }

  function runTitle(run: EnrichedRun): string {
    return run.subtask?.title || run.task?.title || run.target_id || run.subtask_id || run.id;
  }

  function statusLabel(status: string): string {
    const labels: Record<string, string> = {
      queued: "En file",
      preparing: "Preparation",
      running: "En cours",
      awaiting_review: "En review",
      succeeded: "Termine",
      failed: "Echec",
      blocked: "Bloque",
      interrupted: "Interrompu",
      canceled: "Annule",
    };
    return labels[status] ?? status;
  }

  function modeLabel(mode: string): string {
    return mode === "direct" ? "Direct" : "Worktree isole";
  }

  function formatDate(value?: string | null): string {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString();
  }

  function runDuration(run: EnrichedRun): string {
    if (!run.started_at) return "—";
    const start = Date.parse(run.started_at);
    if (!Number.isFinite(start)) return "—";
    const end = run.finished_at ? Date.parse(run.finished_at) : timer.now;
    if (!Number.isFinite(end)) return "—";
    return formatDuration(Math.max(0, Math.round((end - start) / 1000)));
  }

  function timeAgo(value?: string | null): string {
    if (!value) return "—";
    const date = Date.parse(value);
    if (!Number.isFinite(date)) return "—";
    return formatDuration(Math.max(0, Math.round((timer.now - date) / 1000)));
  }

  function claimExpired(claim: ClaimRecord): boolean {
    const expiresMs = Date.parse(claim.expires_at);
    return Number.isFinite(expiresMs) && expiresMs < timer.now;
  }

  function claimAge(claim: ClaimRecord): string {
    const createdMs = Date.parse(claim.created_at);
    if (!Number.isFinite(createdMs)) return "—";
    return formatDuration(Math.max(0, Math.round((timer.now - createdMs) / 1000)));
  }

  function claimAgentLabel(claim: ClaimRecord): string {
    if (claim.agent) {
      const label = formatAgentLabel({
        display_name: null,
        provider: claim.agent.provider,
        model: claim.agent.model ?? null,
      }).withContext;
      return claim.agent.profile ? `${label} · ${claim.agent.profile}` : label;
    }
    return claim.agent_id ?? "non attribue";
  }

  function canCancel(run: EnrichedRun): boolean {
    return run.status === "queued" || run.status === "preparing" || run.status === "running";
  }

  function eventTime(event: Record<string, unknown>): string {
    return typeof event.ts === "string" ? formatDate(event.ts) : "";
  }

  function eventText(event: Record<string, unknown>): string {
    const type = typeof event.type === "string" ? event.type : null;
    const message = typeof event.message === "string" ? event.message : null;
    return [type, message].filter(Boolean).join(" · ") || JSON.stringify(event);
  }

  async function runAction(run: EnrichedRun, action: "cancel" | "approve" | "discard") {
    const labels = {
      cancel: "annuler",
      approve: "approuver",
      discard: "rejeter",
    };
    if (!confirm(`Confirmer : ${labels[action]} ${run.id} ?`)) return;
    busyAction = `${action}:${run.id}`;
    try {
      if (action === "cancel") await cancelRun(run.id, "Stopped from Runs");
      if (action === "approve") await approveRun(run.id, { summary: "Approved from Runs", merge_strategy: "merge_commit" });
      if (action === "discard") await discardRun(run.id, "Discarded from Runs");
      await load();
      onChanged?.();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busyAction = null;
    }
  }

  async function handleArchive(claim: ClaimRecord) {
    if (!confirm(`Finir cette protection ?\n\n${claim.topic}`)) return;
    busyAction = `claim:${claim.id}`;
    try {
      await archiveClaim(claim.id);
      await load();
      onChanged?.();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busyAction = null;
    }
  }

  load();
</script>

{#snippet pathsList(paths: string[], empty = "Aucun fichier precise")}
  {#if paths.length > 0}
    <ul class="paths">
      {#each paths as file (file)}
        <li>{file === "." || file === "/" || file === "*" || file === "**" ? "Tout le workspace" : file}</li>
      {/each}
    </ul>
  {:else}
    <p class="muted">{empty}</p>
  {/if}
{/snippet}

{#snippet body()}
  <header>
    <div class="title-block">
      <h2>{t("claims_view.title")}</h2>
      <div class="tabs">
        <button class="tab" class:active={tab === "all"} onclick={() => switchTab("all")}>
          {t("claims_view.tab.all")} ({runs.length + allLooseClaims.length})
        </button>
        <button class="tab" class:active={tab === "active"} onclick={() => switchTab("active")}>
          {t("claims_view.tab.active")} ({runs.filter((run) => run.active).length + activeLooseClaims.length})
        </button>
        <button class="tab" class:active={tab === "archived"} onclick={() => switchTab("archived")}>
          {t("claims_view.tab.archived")} ({runs.filter((run) => !run.active).length + archivedLooseClaims.length})
        </button>
      </div>
    </div>
    <div class="header-actions">
      <button class="refresh" onclick={load} title="Rafraichir">Rafraichir</button>
      {#if !embedded}
        <button class="close" onclick={onClose}>x</button>
      {/if}
    </div>
  </header>

  {#if error}
    <div class="error">{error}</div>
  {/if}

  {#if loading}
    <div class="loading">Chargement...</div>
  {:else if visibleRuns.length === 0 && looseClaims.length === 0}
    <div class="empty">Aucun run a afficher.</div>
  {:else}
    <div class="runs-layout">
      <aside class="run-list" aria-label="Runs">
        {#each visibleRuns as run, index (run.id)}
          {#if tab === "all" && (index === 0 || visibleRuns[index - 1]?.active !== run.active)}
            <div class="group-title">{run.active ? "Actifs" : "Archives"}</div>
          {/if}
          <button
            class="run-row"
            class:active={selection?.kind === "run" && selection.id === run.id}
            onclick={() => (selection = { kind: "run", id: run.id })}
          >
            <span class="row-top">
              <strong>{runTitle(run)}</strong>
              <span class="status status-{run.status}">{statusLabel(run.status)}</span>
            </span>
            <span class="row-meta">
              <span>{run.repo}</span>
              <span>{ownerLabel(run)}</span>
              <span>{runDuration(run)}</span>
            </span>
            <span class="row-meta small">
              <code>{run.id}</code>
              <span>{run.protects_repository ? "protege tout le workspace" : `${run.protected_paths.length || run.planned_paths.length} fichier(s)`}</span>
              {#if run.finished_at}<span>{t("claims_view.finished_ago", { time: timeAgo(run.finished_at) })}</span>{/if}
            </span>
          </button>
        {/each}

        {#if looseClaims.length > 0}
          <div class="group-title">Protections sans run</div>
          {#each looseClaims as claim (claim.id)}
            <button
              class="run-row claim-row"
              class:active={selection?.kind === "claim" && selection.id === claim.id}
              onclick={() => (selection = { kind: "claim", id: claim.id })}
            >
              <span class="row-top">
                <strong>{claim.topic}</strong>
                <span class="status">{claim.status === "active" && claimExpired(claim) ? "Expiree" : claim.status}</span>
              </span>
              <span class="row-meta">
                <span>{claim.repo}</span>
                <span>{claimAgentLabel(claim)}</span>
                <span>{claim.paths.length} fichier(s)</span>
              </span>
              <span class="row-meta small"><code>{claim.id}</code></span>
            </button>
          {/each}
        {/if}
      </aside>

      <section class="detail" aria-label="Details">
        {#if selectedRun}
          <div class="detail-header">
            <div>
              <p class="eyebrow">{selectedRun.id}</p>
              <h3>{runTitle(selectedRun)}</h3>
            </div>
            <span class="status status-{selectedRun.status}">{statusLabel(selectedRun.status)}</span>
          </div>

          <div class="detail-actions">
            {#if canCancel(selectedRun)}
              <button onclick={() => runAction(selectedRun, "cancel")} disabled={busyAction === `cancel:${selectedRun.id}`}>
                Annuler
              </button>
            {/if}
            {#if selectedRun.status === "awaiting_review"}
              <button onclick={() => runAction(selectedRun, "approve")} disabled={busyAction === `approve:${selectedRun.id}`}>
                Approuver
              </button>
              <button onclick={() => runAction(selectedRun, "discard")} disabled={busyAction === `discard:${selectedRun.id}`}>
                Rejeter
              </button>
            {/if}
          </div>

          <div class="info-grid">
            <div><span>Appartient a</span><strong>{ownerLabel(selectedRun)}</strong></div>
            <div><span>Workspace</span><strong>{selectedRun.repo}</strong></div>
            <div><span>Execution</span><strong>{modeLabel(selectedRun.execution_mode)}</strong></div>
            <div><span>Duree</span><strong>{runDuration(selectedRun)}</strong></div>
            <div><span>Debut</span><strong>{formatDate(selectedRun.started_at)}</strong></div>
            <div>
              <span>Fin</span>
              <strong>
                {formatDate(selectedRun.finished_at)}
                {#if selectedRun.finished_at}<small>{t("claims_view.finished_ago", { time: timeAgo(selectedRun.finished_at) })}</small>{/if}
              </strong>
            </div>
            <div><span>Branche</span><code>{selectedRun.branch}</code></div>
            <div><span>Worktree</span><code>{selectedRun.worktree_path}</code></div>
          </div>

          {#if selectedRun.task || selectedRun.subtask}
            <section class="block">
              <h4>Tache</h4>
              {#if selectedRun.task}
                <p><strong>{selectedRun.task.title}</strong> <code>{selectedRun.task.id}</code></p>
              {/if}
              {#if selectedRun.subtask}
                <p>{selectedRun.subtask.title} <code>{selectedRun.subtask.id}</code></p>
                <div class="chips">
                  <span>{selectedRun.subtask.status}</span>
                  <span>{selectedRun.subtask.risk}</span>
                  <span>{selectedRun.subtask.claim_mode}</span>
                  {#if selectedRun.subtask.manual_approval_required}<span>review manuelle</span>{/if}
                </div>
              {/if}
            </section>
          {/if}

          <section class="block">
            <h4>Protection</h4>
            {#if selectedRun.protects_repository}
              <p class="notice">Ce run protege tout le workspace.</p>
            {/if}
            {#if selectedRun.claims.length > 0}
              {#each selectedRun.claims as claim (claim.id)}
                <div class="claim-detail">
                  <div class="claim-title">
                    <strong>{claim.topic}</strong>
                    <span>{claim.mode}</span>
                    <code>{claim.id}</code>
                  </div>
                  {@render pathsList(claim.paths)}
                  <p class="muted">
                    {claim.status} · {claimAgentLabel(claim)} · expire {formatRemaining(claim.expires_at, timer.now) ?? "maintenant"}
                  </p>
                </div>
              {/each}
            {:else}
              <p class="muted">Aucune protection active liee au run.</p>
            {/if}
            {#if selectedRun.planned_paths.length > 0}
              <h5>Scopes prevus</h5>
              {@render pathsList(selectedRun.planned_paths)}
            {/if}
          </section>

          {#if selectedRun.artifacts.length > 0}
            <section class="block">
              <h4>Artefacts</h4>
              <ul class="artifact-list">
                {#each selectedRun.artifacts as artifact, index (`${artifact.kind}:${artifact.value}:${index}`)}
                  <li><span>{artifact.kind}</span><code>{artifact.value}</code></li>
                {/each}
              </ul>
            </section>
          {/if}

          {#if selectedRun.handoff_path || selectedRun.result}
            <section class="block">
              <h4>Resultat</h4>
              {#if selectedRun.result}<p>{selectedRun.result}</p>{/if}
              {#if selectedRun.handoff_path}<p><span class="muted">Handoff</span> <code>{selectedRun.handoff_path}</code></p>{/if}
            </section>
          {/if}

          {#if selectedRun.events.length > 0}
            <section class="block">
              <h4>Evenements</h4>
              <ol class="events">
                {#each selectedRun.events as event, index (index)}
                  <li>
                    <span>{eventTime(event)}</span>
                    <p>{eventText(event)}</p>
                  </li>
                {/each}
              </ol>
            </section>
          {/if}

          <details class="raw">
            <summary>Donnees completes</summary>
            <pre>{JSON.stringify(selectedRun, null, 2)}</pre>
          </details>
        {:else if selectedClaim}
          <div class="detail-header">
            <div>
              <p class="eyebrow">{selectedClaim.id}</p>
              <h3>{selectedClaim.topic}</h3>
            </div>
            <span class="status">{selectedClaim.status === "active" && claimExpired(selectedClaim) ? "Expiree" : selectedClaim.status}</span>
          </div>
          {#if selectedClaim.status === "active"}
            <div class="detail-actions">
              <button onclick={() => handleArchive(selectedClaim)} disabled={busyAction === `claim:${selectedClaim.id}`}>
                Finir
              </button>
            </div>
          {/if}
          <div class="info-grid">
            <div><span>Workspace</span><strong>{selectedClaim.repo}</strong></div>
            <div><span>Appartient a</span><strong>{claimAgentLabel(selectedClaim)}</strong></div>
            <div><span>Mode</span><strong>{selectedClaim.mode}</strong></div>
            <div><span>Age</span><strong>{claimAge(selectedClaim)}</strong></div>
            <div><span>Debut</span><strong>{formatDate(selectedClaim.created_at)}</strong></div>
            <div><span>Expire</span><strong>{formatDate(selectedClaim.expires_at)}</strong></div>
          </div>
          <section class="block">
            <h4>Fichiers proteges</h4>
            {@render pathsList(selectedClaim.paths)}
          </section>
          {#if selectedClaim.metadata && Object.keys(selectedClaim.metadata).length > 0}
            <section class="block">
              <h4>Metadonnees</h4>
              <div class="chips">
                {#each Object.entries(selectedClaim.metadata) as [key, value] (key)}
                  <span><strong>{key}</strong>: {value}</span>
                {/each}
              </div>
            </section>
          {/if}
          <details class="raw">
            <summary>Donnees completes</summary>
            <pre>{JSON.stringify(selectedClaim, null, 2)}</pre>
          </details>
        {:else}
          <div class="empty">Selectionne un run pour voir ses details.</div>
        {/if}
      </section>
    </div>
  {/if}
{/snippet}

{#if embedded}
  <div class="embedded">{@render body()}</div>
{:else}
  <div class="backdrop" onclick={onClose} role="presentation">
    <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex={-1} onkeydown={(e) => { if (e.key === "Escape") onClose(); }}>
      {@render body()}
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: var(--backdrop);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }
  .modal {
    background: var(--bg-surface);
    color: var(--text-primary);
    border-radius: 8px;
    box-shadow: var(--shadow-modal);
    max-width: 980px;
    width: 94%;
    max-height: 84vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .embedded {
    background: var(--bg-app);
    color: var(--text-primary);
    height: 100%;
    width: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  header {
    padding: 14px 18px;
    border-bottom: 1px solid var(--border-default);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex: 0 0 auto;
  }
  .title-block {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }
  h2, h3, h4, h5, p { margin: 0; }
  h2 { font-size: 16px; }
  h3 { font-size: 18px; }
  h4 { font-size: 13px; color: var(--text-primary); }
  h5 { font-size: 12px; color: var(--text-secondary); margin: 10px 0 4px; }
  .tabs {
    display: flex;
    gap: 4px;
    background: var(--bg-hover);
    border-radius: 6px;
    padding: 2px;
  }
  .tab {
    background: transparent;
    border: none;
    padding: 4px 10px;
    cursor: pointer;
    font-size: 12px;
    color: var(--text-secondary);
    border-radius: 4px;
  }
  .tab:hover { color: var(--text-primary); }
  .tab.active {
    background: var(--bg-surface);
    color: var(--text-primary);
    box-shadow: 0 1px 2px rgba(16, 24, 40, 0.08);
  }
  .header-actions { display: flex; gap: 6px; }
  .refresh, .close, .detail-actions button {
    background: var(--bg-hover);
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    padding: 4px 10px;
    cursor: pointer;
    font-size: 12px;
    color: var(--text-primary);
  }
  .refresh:hover, .detail-actions button:hover:not(:disabled) { background: var(--bg-active); }
  .close { border: none; font-size: 16px; padding: 2px 8px; }
  .error { background: var(--warning-bg); color: var(--warning); padding: 8px 18px; font-size: 12px; }
  .loading, .empty {
    padding: 32px;
    text-align: center;
    color: var(--text-muted);
    font-size: 13px;
  }
  .runs-layout {
    min-height: 0;
    flex: 1 1 auto;
    display: grid;
    grid-template-columns: minmax(280px, 38%) minmax(0, 1fr);
    overflow: hidden;
  }
  .run-list {
    border-right: 1px solid var(--border-default);
    overflow-y: auto;
    padding: 8px;
    background: var(--bg-muted);
  }
  .group-title {
    padding: 8px 8px 4px;
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
  }
  .run-row {
    width: 100%;
    border: 1px solid transparent;
    background: transparent;
    color: var(--text-primary);
    border-radius: 6px;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 5px;
    text-align: left;
    cursor: pointer;
  }
  .run-row:hover { background: var(--bg-hover); }
  .run-row.active {
    background: var(--bg-surface);
    border-color: var(--border-strong);
  }
  .claim-row { opacity: 0.92; }
  .row-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-width: 0;
  }
  .row-top strong {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
  }
  .row-meta {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    color: var(--text-muted);
    font-size: 11px;
  }
  .row-meta.small { color: var(--text-subtle); }
  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px;
    background: var(--bg-hover);
    color: var(--text-body);
    padding: 1px 4px;
    border-radius: 3px;
    word-break: break-all;
  }
  .status {
    flex: 0 0 auto;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    border-radius: 999px;
    padding: 2px 7px;
    background: var(--bg-hover);
    color: var(--text-secondary);
  }
  .status-running, .status-preparing, .status-queued {
    background: var(--accent-bg);
    color: var(--accent-text);
  }
  .status-awaiting_review {
    background: var(--warning-bg);
    color: var(--warning);
  }
  .status-succeeded {
    background: var(--success-bg);
    color: var(--success);
  }
  .status-failed, .status-blocked, .status-canceled, .status-interrupted {
    background: var(--danger-bg);
    color: var(--danger);
  }
  .detail {
    overflow-y: auto;
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    min-width: 0;
  }
  .detail-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
  }
  .eyebrow {
    color: var(--text-muted);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px;
    margin-bottom: 4px;
  }
  .detail-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .detail-actions button:disabled {
    opacity: 0.55;
    cursor: wait;
  }
  .info-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 8px;
  }
  .info-grid > div {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 9px 10px;
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
    background: var(--bg-muted);
    min-width: 0;
  }
  .info-grid span, .muted {
    color: var(--text-muted);
    font-size: 12px;
  }
  .info-grid strong {
    font-size: 13px;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .info-grid strong small {
    display: block;
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 500;
    margin-top: 2px;
  }
  .block {
    border-top: 1px solid var(--border-subtle);
    padding-top: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .notice {
    border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
    color: var(--accent-text);
    background: var(--accent-bg);
    border-radius: 6px;
    padding: 8px 10px;
    font-size: 12px;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chips span {
    border-radius: 999px;
    padding: 3px 8px;
    background: var(--bg-hover);
    color: var(--text-body);
    font-size: 11px;
  }
  .claim-detail {
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
    padding: 10px;
    background: var(--bg-muted);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .claim-title {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .claim-title span {
    font-size: 10px;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .paths {
    list-style: none;
    margin: 0;
    padding: 7px 9px;
    border-radius: 5px;
    background: var(--bg-hover);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px;
    color: var(--text-body);
  }
  .paths li {
    padding: 2px 0;
    overflow-wrap: anywhere;
  }
  .artifact-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .artifact-list li {
    display: flex;
    gap: 8px;
    align-items: baseline;
    min-width: 0;
  }
  .artifact-list span {
    min-width: 78px;
    color: var(--text-muted);
    font-size: 12px;
  }
  .events {
    margin: 0;
    padding-left: 18px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .events li span {
    color: var(--text-muted);
    font-size: 11px;
  }
  .events li p {
    margin-top: 2px;
    font-size: 12px;
    color: var(--text-body);
    overflow-wrap: anywhere;
  }
  .raw {
    border-top: 1px solid var(--border-subtle);
    padding-top: 12px;
  }
  .raw summary {
    cursor: pointer;
    color: var(--text-muted);
    font-size: 12px;
  }
  .raw pre {
    margin: 8px 0 0;
    padding: 10px;
    background: var(--bg-muted);
    border-radius: 6px;
    overflow: auto;
    font-size: 11px;
    line-height: 1.45;
  }
  @media (max-width: 860px) {
    .runs-layout {
      grid-template-columns: 1fr;
    }
    .run-list {
      max-height: 260px;
      border-right: none;
      border-bottom: 1px solid var(--border-default);
    }
    .title-block {
      align-items: flex-start;
      flex-direction: column;
    }
  }
</style>
