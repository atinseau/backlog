<script lang="ts">
  import { createTask, moveTask, refineTask } from "./api.js";
  import { t } from "./i18n.svelte.js";
  import type { TaskCard } from "./types.js";

  interface Props {
    items: TaskCard[];
    availableRepositories: string[];
    embedded?: boolean;
    onClose: () => void;
    onChanged?: () => void;
    onOpen?: (card: TaskCard) => void;
  }

  let { items, availableRepositories, embedded = false, onClose, onChanged, onOpen }: Props = $props();

  let draft = $state("");
  let repoTargets = $state<string[]>([]);
  let priority = $state<"P0" | "P1" | "P2" | "P3">("P2");
  let busy = $state<string | null>(null);
  let creating = $state(false);
  let error = $state<string | null>(null);

  function focusOnMount(node: HTMLElement): void {
    queueMicrotask(() => node.focus());
  }

  function toggleRepository(id: string) {
    repoTargets = repoTargets.includes(id) ? repoTargets.filter((r) => r !== id) : [...repoTargets, id];
  }

  function timeAgo(iso: string): string {
    const date = new Date(iso);
    const diff = Date.now() - date.getTime();
    if (!Number.isFinite(diff)) return iso;
    const minute = 60_000;
    const hour = 60 * minute;
    const day = 24 * hour;
    if (diff < minute) return t("time.just_now");
    if (diff < hour) return t("time.minutes_ago", { count: Math.max(1, Math.round(diff / minute)) });
    if (diff < day) return t("time.hours_ago", { count: Math.max(1, Math.round(diff / hour)) });
    return t("time.days_ago", { count: Math.max(1, Math.round(diff / day)) });
  }

  async function createBacklogItem(event: SubmitEvent) {
    event.preventDefault();
    if (!draft.trim() || creating) return;
    creating = true;
    error = null;
    try {
      const input: Parameters<typeof createTask>[0] = {
        description: draft.trim(),
        priority,
        status: "backlog",
      };
      if (repoTargets.length > 0) input.repo_targets = repoTargets;
      await createTask(input);
      draft = "";
      repoTargets = [];
      priority = "P2";
      onChanged?.();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      creating = false;
    }
  }

  async function promote(card: TaskCard) {
    busy = card.id;
    error = null;
    try {
      await moveTask(card.id, "ready");
      onChanged?.();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = null;
    }
  }

  async function refine(card: TaskCard) {
    busy = card.id;
    error = null;
    try {
      await refineTask(card.id);
      onChanged?.();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = null;
    }
  }
</script>

{#snippet body()}
  <header class="view-header">
    <div>
      <h2>{t("backlog_view.title")}</h2>
      <p>{t("backlog_view.subtitle")}</p>
    </div>
    {#if !embedded}
      <button class="close" onclick={onClose}>✕</button>
    {/if}
  </header>

  {#if error}
    <div class="error">{error}</div>
  {/if}

  <form class="composer" onsubmit={createBacklogItem}>
    <textarea
      bind:value={draft}
      rows="3"
      use:focusOnMount
      placeholder={t("backlog_view.placeholder")}
    ></textarea>
    <div class="composer-row">
      <select bind:value={priority} aria-label={t("create_task.field.priority")}>
        <option value="P0">P0</option>
        <option value="P1">P1</option>
        <option value="P2">P2</option>
        <option value="P3">P3</option>
      </select>
      {#if availableRepositories.length > 0}
        <div class="repository-chips" aria-label={t("create_task.field.repos")}>
          {#each availableRepositories as repository (repository)}
            <label class="chip">
              <input
                type="checkbox"
                checked={repoTargets.includes(repository)}
                onchange={() => toggleRepository(repository)}
              />
              <span>{repository}</span>
            </label>
          {/each}
        </div>
      {/if}
      <button class="primary" type="submit" disabled={!draft.trim() || creating}>
        {creating ? t("backlog_view.adding") : t("backlog_view.add")}
      </button>
    </div>
  </form>

  <section class="list" aria-label={t("backlog_view.title")}>
    {#if items.length === 0}
      <div class="empty">{t("backlog_view.empty")}</div>
    {:else}
      {#each items as card (card.id)}
        <article class="item">
          <button class="item-main" type="button" onclick={() => onOpen?.(card)}>
            <div class="item-top">
              <span class="priority pri-{card.priority.toLowerCase()}">{card.priority}</span>
              <strong>{card.title}</strong>
            </div>
            {#if card.description}
              <p>{card.description}</p>
            {/if}
            <div class="meta">
              <span>{timeAgo(card.created_at)}</span>
              {#if card.repo_targets.length > 0}<span>{card.repo_targets.join(", ")}</span>{/if}
              {#if card.labels.length > 0}<span>{card.labels.join(", ")}</span>{/if}
            </div>
          </button>
          <div class="actions">
            <button type="button" onclick={() => refine(card)} disabled={busy !== null}>
              {busy === card.id ? "…" : t("backlog_view.refine")}
            </button>
            <button class="primary" type="button" onclick={() => promote(card)} disabled={busy !== null}>
              {busy === card.id ? "…" : t("backlog_view.promote")}
            </button>
          </div>
        </article>
      {/each}
    {/if}
  </section>
{/snippet}

{#if embedded}
  <div class="embedded">{@render body()}</div>
{:else}
  <div class="backdrop" onclick={onClose} role="presentation">
    <div
      class="modal"
      onclick={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal="true"
      tabindex={-1}
      onkeydown={(e) => { if (e.key === "Escape") onClose(); }}
    >
      {@render body()}
    </div>
  </div>
{/if}

<style>
  .embedded {
    height: 100%;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg-surface);
    color: var(--text-primary);
  }
  .backdrop {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--backdrop);
    z-index: 100;
  }
  .modal {
    width: min(920px, 94vw);
    max-height: 88vh;
    max-height: 88dvh;
    border-radius: 8px;
    overflow: hidden;
    background: var(--bg-surface);
    color: var(--text-primary);
    box-shadow: var(--shadow-modal);
    display: flex;
    flex-direction: column;
  }
  .view-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 18px 22px;
    border-bottom: 1px solid var(--border-default);
  }
  .view-header h2 {
    margin: 0;
    /* Display grade — 18px is the top of the ramp. */
    font-size: 18px;
  }
  .view-header p {
    margin: 4px 0 0;
    color: var(--text-muted);
    font-size: 13px;
  }
  .close {
    border: none;
    background: transparent;
    color: var(--text-secondary);
    font-size: 18px;
    cursor: pointer;
    /* WCAG 2.5.8 floor — 24px, 28px under a coarse pointer. */
    min-width: var(--tap-size);
    min-height: var(--tap-size);
    border-radius: 4px;
  }
  .error {
    margin: 12px 22px 0;
    color: var(--danger);
    background: var(--danger-bg);
    border: 1px solid color-mix(in srgb, var(--danger) 35%, transparent);
    border-radius: 6px;
    padding: 8px 10px;
    font-size: 12px;
  }
  .composer {
    padding: 16px 22px;
    border-bottom: 1px solid var(--border-default);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  textarea,
  select {
    background: var(--bg-input);
    color: var(--text-primary);
    /* Input outline owes 3:1 (WCAG 1.4.11). */
    border: 1px solid var(--border-field);
    border-radius: 4px;
    font: inherit;
  }
  textarea {
    width: 100%;
    resize: vertical;
    min-height: 72px;
    padding: 10px;
  }
  select {
    height: 32px;
    padding: 0 8px;
  }
  .composer-row {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }
  .repository-chips {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    border: 1px solid var(--border-default);
    border-radius: 4px;
    padding: 4px 7px;
    color: var(--text-secondary);
    font-size: 12px;
    /* WCAG 2.5.8 floor — the whole label is the checkbox's target. */
    min-height: var(--tap-size);
  }
  .chip input { margin: 0; }
  .primary {
    background: var(--accent);
    color: var(--accent-on);
    border-color: var(--accent);
  }
  button {
    /* Transparent-on-surface control: same 3:1 outline rule as a field. */
    border: 1px solid var(--border-field);
    border-radius: 4px;
    background: var(--bg-input);
    color: var(--text-primary);
    font: inherit;
    cursor: pointer;
    padding: 7px 12px;
  }
  button:disabled {
    opacity: 0.55;
    cursor: default;
  }
  .list {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 12px 22px 24px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .empty {
    color: var(--text-muted);
    font-size: 13px;
    padding: 24px 0;
    text-align: center;
  }
  .item {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 12px;
    align-items: center;
    border: 1px solid var(--border-default);
    border-radius: 6px;
    background: var(--bg-elevated);
    padding: 10px;
  }
  .item-main {
    border: none;
    background: transparent;
    padding: 0;
    text-align: left;
    min-width: 0;
  }
  .item-main:hover strong {
    color: var(--accent-text);
  }
  .item-top {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .item-top strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .priority {
    /* 10px is only legal in spaced caps — P0…P3 already are. */
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.04em;
    border-radius: 3px;
    padding: 2px 5px;
    flex-shrink: 0;
  }
  .pri-p0 { background: var(--danger-bg); color: var(--danger); }
  .pri-p1 { background: var(--warning-bg); color: var(--warning); }
  .pri-p2 { background: var(--accent-bg); color: var(--accent-text); }
  .pri-p3 { background: var(--bg-hover); color: var(--text-secondary); }
  .item p {
    margin: 7px 0 0;
    color: var(--text-secondary);
    font-size: 13px;
    white-space: pre-wrap;
  }
  .meta {
    margin-top: 8px;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    color: var(--text-muted);
    font-size: 11px;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  /* BP_COMPACT — see src/lib/shell/breakpoints.ts */
  @media (max-width: 900px) {
    .composer-row,
    .item {
      grid-template-columns: 1fr;
      flex-direction: column;
      align-items: stretch;
    }
    .actions {
      justify-content: flex-end;
    }
  }
</style>
