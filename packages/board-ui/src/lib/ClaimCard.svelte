<script lang="ts">
  import { archiveClaim } from "./api.js";
  import { t } from "./i18n.svelte.js";
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
    if (!confirm(t("claim_card.confirm_finish", { topic: claim.topic }))) return;
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
      <button
        class="finish-btn"
        onclick={handleFinish}
        disabled={archiving}
        title={t("claim_card.finish")}
        aria-label={t("claim_card.finish")}
      >
        {archiving ? "…" : "✓"}
      </button>
    {/if}
  </header>

  <div class="chips">
    <span class="chip repo">{claim.repo}</span>
    {#if agentLabel()}
      {@const url = sessionResumeUrl()}
      {#if url}
        <a class="chip session" href={url} title={t("claim_card.resume_session")} onclick={(e) => e.stopPropagation()}>
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
      <li class="more">{t("claim_card.more_paths", { count: claim.paths.length - 3 })}</li>
    {/if}
  </ul>

  <footer>
    {#if claim.status === "archived"}
      {#if claim.finished_at}
        <span>{t("claim_card.finished_ago", { time: formatDuration(finishedAgoSeconds() ?? 0) })}</span>
      {:else}
        <span>{t("claim_card.archived_after_expiry")}</span>
      {/if}
    {:else if isExpired()}
      <span class="warn">⚠ {t("claim_card.expired")}</span>
    {:else}
      <span>{t("claim_card.age_ago", { time: formatDuration(ageSeconds()) })}</span>
      <span class="dot">·</span>
      <span>
        {t("claim_card.expires_in", {
          time: formatRemaining(claim.expires_at, timer.now) ?? t("claim_card.less_than_a_second"),
        })}
      </span>
    {/if}
  </footer>
</article>

<style>
  .claim-card {
    background: var(--bg-surface);
    border-radius: 6px;
    padding: 10px 12px;
    margin-bottom: 8px;
    box-shadow: var(--elev-rest);
    /* The 3px coloured left rail belongs to Card.svelte's priority rail
       and nowhere else (DESIGN.md, "Shapes"). Expiry is carried by the
       1px rule + the tinted background + the "expired" footer chip. */
    border: 1px solid var(--border-subtle);
    cursor: default;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .claim-card.expired {
    border-color: var(--danger);
    background: var(--warning-bg);
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
    color: var(--text-primary);
  }
  .mode {
    font-size: 10px;
    letter-spacing: 0.04em;
    font-weight: 600;
    padding: 1px 5px;
    border-radius: 3px;
    text-transform: uppercase;
    flex-shrink: 0;
  }
  .mode-exclusive { background: var(--danger-bg); color: var(--danger); }
  .mode-shared { background: var(--success-bg); color: var(--success); }
  .finish-btn {
    background: transparent;
    border: 1px solid var(--border-field);
    border-radius: 4px;
    padding: 1px 6px;
    /* WCAG 2.5.8 floor; --tap-size widens to 28px on a coarse pointer. */
    min-width: var(--tap-size);
    min-height: var(--tap-size);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    font-size: 11px;
    color: var(--success);
    flex-shrink: 0;
  }
  .finish-btn:hover:not(:disabled) {
    background: var(--success-bg);
    border-color: var(--success);
  }
  .finish-btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .chip {
    /* Chip content is a repository / agent name, not a spaced caps
       label, so it sits at 11px rather than the 10px micro grade. */
    font-size: 11px;
    padding: 1px 6px;
    border-radius: 3px;
    text-decoration: none;
  }
  .chip.repo { background: var(--accent-bg); color: var(--accent-text); }
  /* Violet ink belongs on the violet tint, not on the blue one:
     --apply-text over --accent-bg only reached 2.53:1. */
  .chip.agent { background: var(--apply-bg); color: var(--apply-text); }
  .chip.session {
    background: var(--apply-bg);
    color: var(--apply-text);
    cursor: pointer;
  }
  .chip.session:hover { background: var(--apply-bg); }
  .session-title {
    font-size: 11px;
    /* Tinted background replaces the 2px violet rail — same marker,
       a support the design system allows. */
    color: var(--apply-text);
    background: var(--apply-bg);
    padding: 3px 6px;
    border-radius: 3px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .paths {
    list-style: none;
    margin: 0;
    padding: 4px 6px;
    background: var(--bg-muted);
    border-radius: 3px;
    font-family: ui-monospace, monospace;
    font-size: 11px;
    color: var(--text-secondary);
  }
  .paths li {
    padding: 1px 0;
    word-break: break-all;
  }
  .paths li.more { color: var(--text-muted); font-style: italic; }
  footer {
    display: flex;
    gap: 6px;
    font-size: 11px;
    color: var(--text-muted);
    align-items: center;
  }
  .dot { opacity: 0.5; }
  .warn { color: var(--danger); font-weight: 500; }
</style>
