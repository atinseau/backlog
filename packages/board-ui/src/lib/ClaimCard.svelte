<script lang="ts">
  import { archiveClaim } from "./api.js";
  import { formatDuration, formatRemaining, useTimer } from "./timer.svelte.js";
  import type { ClaimRecord } from "./types.js";
  import { onDestroy } from "svelte";

  interface Props {
    claim: ClaimRecord;
    onChanged?: () => void;
  }

  let { claim, onChanged }: Props = $props();

  const timer = useTimer();
  onDestroy(() => timer.release());

  let archiving = $state(false);

  function isExpired(): boolean {
    const t = Date.parse(claim.expires_at);
    return Number.isFinite(t) && t < timer.now;
  }

  function ageSeconds(): number {
    const t = Date.parse(claim.created_at);
    return Math.max(0, Math.round((timer.now - t) / 1000));
  }

  function finishedAgoSeconds(): number | null {
    if (!claim.finished_at) return null;
    const t = Date.parse(claim.finished_at);
    if (!Number.isFinite(t)) return null;
    return Math.max(0, Math.round((timer.now - t) / 1000));
  }

  function agentLabel(): string {
    if (claim.agent) {
      const parts = [claim.agent.provider];
      if (claim.agent.model) parts.push(claim.agent.model);
      return parts.join(" · ");
    }
    if (claim.agent_id) return claim.agent_id;
    if (claim.metadata?.source) {
      const parts = [claim.metadata.source];
      if (claim.metadata.model) parts.push(claim.metadata.model);
      return parts.join(" · ");
    }
    return "";
  }

  function sessionResumeUrl(): string | null {
    if (claim.metadata?.source !== "claude-code") return null;
    const id = claim.metadata.session_id;
    if (!id) return null;
    return `claude://resume/${id}`;
  }

  async function handleFinish(event: MouseEvent) {
    event.stopPropagation();
    if (!confirm(`Finir le claim "${claim.topic}" ?`)) return;
    archiving = true;
    try {
      await archiveClaim(claim.id);
      onChanged?.();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      archiving = false;
    }
  }
</script>

<article class="claim-card" class:expired={claim.status === "active" && isExpired()}>
  <header>
    <span class="mode mode-{claim.mode}">{claim.mode}</span>
    <h3>{claim.topic}</h3>
    {#if claim.status === "active"}
      <button class="finish-btn" onclick={handleFinish} disabled={archiving} title="Finir le claim">
        {archiving ? "…" : "✓"}
      </button>
    {/if}
  </header>

  <div class="chips">
    <span class="chip repo">{claim.repo}</span>
    {#if agentLabel()}
      {@const url = sessionResumeUrl()}
      {#if url}
        <a class="chip session" href={url} title="Reprendre la session" onclick={(e) => e.stopPropagation()}>
          ↗ {agentLabel()}
        </a>
      {:else}
        <span class="chip agent">{agentLabel()}</span>
      {/if}
    {/if}
  </div>

  {#if claim.metadata?.session_title}
    <div class="session-title" title={claim.metadata.session_title}>
      💬 {claim.metadata.session_title}
    </div>
  {/if}

  <ul class="paths">
    {#each claim.paths.slice(0, 3) as p (p)}
      <li>{p}</li>
    {/each}
    {#if claim.paths.length > 3}
      <li class="more">+ {claim.paths.length - 3} autres</li>
    {/if}
  </ul>

  <footer>
    {#if claim.status === "archived"}
      {#if claim.finished_at}
        <span>terminé il y a {formatDuration(finishedAgoSeconds() ?? 0)}</span>
      {:else}
        <span>archivé après expiration</span>
      {/if}
    {:else if isExpired()}
      <span class="warn">⚠ expiré</span>
    {:else}
      <span>il y a {formatDuration(ageSeconds())}</span>
      <span class="dot">·</span>
      <span>expire dans {formatRemaining(claim.expires_at, timer.now) ?? "moins d'une seconde"}</span>
    {/if}
  </footer>
</article>

<style>
  .claim-card {
    background: white;
    border-radius: 6px;
    padding: 10px 12px;
    margin-bottom: 8px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
    border-left: 3px solid #98a2b3;
    cursor: default;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .claim-card.expired {
    border-left-color: #b42318;
    background: #fef9f3;
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  h3 {
    margin: 0;
    font-size: 13px;
    line-height: 1.3;
    flex: 1;
    color: #1d2939;
  }
  .mode {
    font-size: 9px;
    font-weight: 600;
    padding: 1px 5px;
    border-radius: 3px;
    text-transform: uppercase;
    flex-shrink: 0;
  }
  .mode-exclusive { background: #fee4e2; color: #b42318; }
  .mode-shared { background: #d1fadf; color: #027a48; }
  .finish-btn {
    background: transparent;
    border: 1px solid #d0d5dd;
    border-radius: 4px;
    padding: 1px 6px;
    cursor: pointer;
    font-size: 11px;
    color: #027a48;
    flex-shrink: 0;
  }
  .finish-btn:hover:not(:disabled) {
    background: #d1fadf;
    border-color: #027a48;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .chip {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 3px;
    text-decoration: none;
  }
  .chip.repo { background: #eff8ff; color: #175cd3; }
  .chip.agent { background: #f4ebff; color: #6941c6; }
  .chip.session {
    background: #f4ebff;
    color: #6941c6;
    cursor: pointer;
  }
  .chip.session:hover { background: #e9d7fe; }
  .session-title {
    font-size: 11px;
    color: #344054;
    background: #fafafa;
    border-left: 2px solid #6941c6;
    padding: 3px 6px;
    border-radius: 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .paths {
    list-style: none;
    margin: 0;
    padding: 4px 6px;
    background: #f9fafb;
    border-radius: 3px;
    font-family: ui-monospace, monospace;
    font-size: 10px;
    color: #475467;
  }
  .paths li {
    padding: 1px 0;
    word-break: break-all;
  }
  .paths li.more { color: #98a2b3; font-style: italic; }
  footer {
    display: flex;
    gap: 6px;
    font-size: 10px;
    color: #667085;
    align-items: center;
  }
  .dot { opacity: 0.5; }
  .warn { color: #b42318; font-weight: 500; }
</style>
