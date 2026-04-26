<script lang="ts">
  import { archiveClaim, fetchAllClaims } from "./api.js";
  import { formatDuration, formatRemaining, useTimer } from "./timer.svelte.js";
  import type { ClaimRecord } from "./types.js";
  import { onDestroy } from "svelte";

  interface Props {
    onClose: () => void;
    onChanged?: () => void;
  }

  let { onClose, onChanged }: Props = $props();

  const timer = useTimer();
  onDestroy(() => timer.release());

  let activeClaims = $state<ClaimRecord[]>([]);
  let archivedClaims = $state<ClaimRecord[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let archiving = $state<string | null>(null);
  let tab = $state<"active" | "archived">("active");

  const claims = $derived(tab === "active" ? activeClaims : archivedClaims);

  async function load() {
    loading = true;
    try {
      const [a, ar] = await Promise.all([
        fetchAllClaims({}),
        fetchAllClaims({ archived: true }),
      ]);
      activeClaims = a;
      archivedClaims = ar;
      error = null;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }

  function switchTab(next: "active" | "archived") {
    tab = next;
  }

  function agentLabel(claim: ClaimRecord): string {
    if (claim.agent) {
      const parts = [claim.agent.provider];
      if (claim.agent.model) parts.push(claim.agent.model);
      if (claim.agent.profile) parts.push(`(${claim.agent.profile})`);
      return parts.join(" · ");
    }
    if (claim.agent_id) return claim.agent_id;
    return "aucun agent attribué";
  }

  async function handleArchive(claim: ClaimRecord) {
    if (!confirm(`Finir le claim "${claim.topic}" ?\n\nIl sera archivé et libérera ses paths.`)) return;
    archiving = claim.id;
    try {
      await archiveClaim(claim.id);
      await load();
      onChanged?.();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      archiving = null;
    }
  }

  function isExpired(claim: ClaimRecord): boolean {
    const expiresMs = Date.parse(claim.expires_at);
    return Number.isFinite(expiresMs) && expiresMs < timer.now;
  }

  function ageSeconds(claim: ClaimRecord): number {
    const createdMs = Date.parse(claim.created_at);
    return Math.max(0, Math.round((timer.now - createdMs) / 1000));
  }

  load();
</script>

<div class="backdrop" onclick={onClose} role="presentation">
  <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
    <header>
      <div class="title-block">
        <h2>Claims</h2>
        <div class="tabs">
          <button class="tab" class:active={tab === "active"} onclick={() => switchTab("active")}>
            Actifs ({activeClaims.length})
          </button>
          <button class="tab" class:active={tab === "archived"} onclick={() => switchTab("archived")}>
            Archivés ({archivedClaims.length})
          </button>
        </div>
      </div>
      <div class="header-actions">
        <button class="refresh" onclick={load} title="Rafraîchir">↻</button>
        <button class="close" onclick={onClose}>✕</button>
      </div>
    </header>

    {#if error}
      <div class="error">{error}</div>
    {/if}

    {#if loading}
      <div class="loading">chargement…</div>
    {:else if claims.length === 0}
      <div class="empty">
        {#if tab === "active"}
          Aucun claim actif. Crée-en un avec <code>backlog claim start</code> ou via le bouton <strong>+ Claim</strong>.
        {:else}
          Aucun claim archivé.
        {/if}
      </div>
    {:else}
      <ul class="claims">
        {#each claims as claim (claim.id)}
          <li class:expired={tab === "active" && isExpired(claim)} class:archived={tab === "archived"}>
            <header class="claim-header">
              <div class="title-line">
                <strong>{claim.topic}</strong>
                <span class="mode mode-{claim.mode}">{claim.mode}</span>
                {#if tab === "active" && isExpired(claim)}<span class="expired-tag">expiré</span>{/if}
                {#if tab === "archived"}<span class="archived-tag">archivé</span>{/if}
              </div>
              {#if tab === "active"}
                <button
                  class="finish"
                  onclick={() => handleArchive(claim)}
                  disabled={archiving === claim.id}
                  title="Finir / archiver le claim"
                >
                  {archiving === claim.id ? "…" : "Finir"}
                </button>
              {/if}
            </header>

            <div class="row">
              <span class="repo">{claim.repo}</span>
              <span class="agent" class:unknown={!claim.agent_id}>→ {agentLabel(claim)}</span>
              <span class="id">{claim.id}</span>
            </div>

            <ul class="paths">
              {#each claim.paths as path (path)}
                <li>{path}</li>
              {/each}
            </ul>

            <div class="meta">
              <span>créé il y a {formatDuration(ageSeconds(claim))}</span>
              <span class="dot">·</span>
              {#if tab === "active"}
                <span>
                  {#if isExpired(claim)}
                    expiré
                  {:else}
                    expire dans {formatRemaining(claim.expires_at, timer.now) ?? "moins d'une seconde"}
                  {/if}
                </span>
                {#if claim.expected_finish_at}
                  <span class="dot">·</span>
                  <span>fin estimée : {formatRemaining(claim.expected_finish_at, timer.now) ?? "dépassée"}</span>
                {/if}
              {:else}
                {#if claim.finished_at}
                  <span>terminé il y a {formatDuration(Math.max(0, Math.round((timer.now - Date.parse(claim.finished_at)) / 1000)))}</span>
                {:else}
                  <span>archivé après expiration</span>
                {/if}
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(16, 24, 40, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }
  .modal {
    background: white;
    border-radius: 8px;
    box-shadow: 0 20px 24px rgba(16, 24, 40, 0.18);
    max-width: 640px;
    width: 92%;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  header {
    padding: 16px 20px;
    border-bottom: 1px solid #e4e7ec;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .title-block {
    display: flex;
    align-items: center;
    gap: 12px;
    flex: 1;
  }
  h2 { margin: 0; font-size: 16px; }
  .tabs {
    display: flex;
    gap: 4px;
    background: #f2f4f7;
    border-radius: 6px;
    padding: 2px;
  }
  .tab {
    background: transparent;
    border: none;
    padding: 4px 10px;
    cursor: pointer;
    font-size: 12px;
    color: #475467;
    border-radius: 4px;
  }
  .tab:hover { color: #1d2939; }
  .tab.active {
    background: white;
    color: #1d2939;
    box-shadow: 0 1px 2px rgba(16, 24, 40, 0.08);
  }
  .header-actions { display: flex; gap: 4px; }
  .refresh, .close {
    background: transparent;
    border: 1px solid #d0d5dd;
    border-radius: 4px;
    padding: 2px 8px;
    cursor: pointer;
    font-size: 13px;
    color: #475467;
  }
  .close { border: none; font-size: 18px; }
  .refresh:hover { background: #f2f4f7; }
  .error { background: #fef0c7; color: #b54708; padding: 8px 20px; font-size: 12px; }
  .loading { padding: 32px; text-align: center; color: #667085; }
  .empty {
    padding: 32px 20px;
    text-align: center;
    color: #667085;
    font-size: 13px;
  }
  .empty code {
    font-family: ui-monospace, monospace;
    background: #f2f4f7;
    padding: 1px 4px;
    border-radius: 3px;
  }
  .claims {
    list-style: none;
    margin: 0;
    padding: 8px 0;
    overflow-y: auto;
    flex: 1;
  }
  .claims > li {
    padding: 12px 20px;
    border-bottom: 1px solid #f0f0f0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .claims > li.expired { background: #fef9f3; opacity: 0.7; }
  .claims > li.archived { opacity: 0.85; }
  .claim-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    border: none;
    padding: 0;
  }
  .title-line {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
  }
  .mode {
    font-size: 10px;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: 3px;
    text-transform: uppercase;
  }
  .mode-exclusive { background: #fee4e2; color: #b42318; }
  .mode-shared { background: #d1fadf; color: #027a48; }
  .expired-tag, .archived-tag {
    font-size: 10px;
    background: #f2f4f7;
    color: #475467;
    padding: 1px 6px;
    border-radius: 3px;
  }
  .archived-tag {
    background: #f4ebff;
    color: #6941c6;
  }
  .finish {
    background: #f2f4f7;
    border: 1px solid #d0d5dd;
    border-radius: 4px;
    padding: 3px 10px;
    cursor: pointer;
    font-size: 12px;
    color: #1d2939;
    flex-shrink: 0;
  }
  .finish:hover:not(:disabled) {
    background: #fee4e2;
    color: #b42318;
    border-color: #fcd9d6;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: #667085;
    flex-wrap: wrap;
  }
  .repo {
    background: #eff8ff;
    color: #175cd3;
    padding: 1px 6px;
    border-radius: 3px;
  }
  .agent {
    background: #f9f5ff;
    color: #6941c6;
    padding: 1px 6px;
    border-radius: 3px;
  }
  .agent.unknown {
    background: transparent;
    color: #98a2b3;
    padding-left: 0;
    font-style: italic;
  }
  .id {
    font-family: ui-monospace, monospace;
    color: #98a2b3;
    margin-left: auto;
  }
  .paths {
    list-style: none;
    margin: 0;
    padding: 0;
    font-family: ui-monospace, monospace;
    font-size: 11px;
    color: #344054;
    background: #f9fafb;
    border-radius: 4px;
    padding: 6px 10px;
  }
  .paths li { padding: 1px 0; word-break: break-all; }
  .meta {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: #667085;
  }
  .dot { opacity: 0.5; }
</style>
