<script lang="ts">
  import { t } from "./i18n.svelte.js";
  import { fetchCommits, type CommitEntry, type CommitLink } from "./api.js";

  interface Props {
    onClose: () => void;
    embedded?: boolean;
  }

  let { onClose, embedded = false }: Props = $props();

  let commits = $state<CommitEntry[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  async function load() {
    loading = true;
    try {
      commits = await fetchCommits(100);
      error = null;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }

  function linkLabel(link: CommitLink): string {
    if (link.kind === "task") return t("commits.task", { id: link.id });
    if (link.kind === "subtask") return t("commits.subtask", { id: link.id });
    return t("commits.claim", { id: link.id });
  }

  function formatDate(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
  }

  load();
</script>

{#snippet body()}
    <header>
      <h2>{t("commits.title")}</h2>
      <div class="header-actions">
        <button class="refresh" onclick={load} title="↻">↻</button>
        {#if !embedded}
          <button class="close" onclick={onClose}>✕</button>
        {/if}
      </div>
    </header>

    {#if error}
      <div class="error">{error}</div>
    {/if}

    {#if loading}
      <div class="loading">…</div>
    {:else if commits.length === 0}
      <div class="empty">{t("commits.empty")}</div>
    {:else}
      <ul class="commits">
        {#each commits as commit (commit.repo + ":" + commit.sha)}
          <li>
            <div class="row1">
              <span class="repo">{commit.repo}</span>
              <code class="sha">{commit.short_sha}</code>
              <span class="subject">{commit.subject}</span>
            </div>
            <div class="row2">
              <span class="author">{commit.author}</span>
              <span class="dot">·</span>
              <span class="date">{formatDate(commit.date)}</span>
              {#if commit.links.length > 0}
                <span class="dot">·</span>
                <span class="linked-label">{t("commits.linked")}</span>
                {#each commit.links as link (link.kind + ":" + link.id)}
                  <span class="link link-{link.kind}">{linkLabel(link)}</span>
                {/each}
              {/if}
            </div>
          </li>
        {/each}
      </ul>
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
    max-width: 720px;
    width: 92%;
    max-height: 80vh;
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
    padding: 16px 20px;
    border-bottom: 1px solid var(--border-default);
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  h2 { margin: 0; font-size: 16px; color: var(--text-primary); }
  .header-actions { display: flex; gap: 4px; }
  .refresh, .close {
    background: transparent;
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    padding: 2px 8px;
    cursor: pointer;
    font-size: 13px;
    color: var(--text-secondary);
  }
  .close { border: none; font-size: 18px; }
  .refresh:hover { background: var(--bg-hover); color: var(--text-primary); }
  .error { background: var(--warning-bg); color: var(--warning); padding: 8px 20px; font-size: 12px; }
  .loading { padding: 32px; text-align: center; color: var(--text-muted); }
  .empty {
    padding: 32px 20px;
    text-align: center;
    color: var(--text-muted);
    font-size: 13px;
  }
  .commits {
    list-style: none;
    margin: 0;
    padding: 8px 0;
    overflow-y: auto;
    flex: 1;
  }
  .commits > li {
    padding: 10px 20px;
    border-bottom: 1px solid var(--border-subtle);
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .row1 {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }
  .repo {
    background: var(--accent-bg);
    color: var(--accent-text);
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 11px;
    font-weight: 500;
  }
  .sha {
    font-family: ui-monospace, monospace;
    font-size: 11px;
    color: var(--text-body);
    background: var(--bg-elevated);
    padding: 1px 6px;
    border-radius: 3px;
  }
  .subject {
    color: var(--text-primary);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .row2 {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--text-muted);
    flex-wrap: wrap;
  }
  .dot { opacity: 0.5; }
  .linked-label { font-style: italic; }
  .link {
    padding: 1px 6px;
    border-radius: 3px;
    font-family: ui-monospace, monospace;
    font-size: 10px;
  }
  .link-task {
    background: var(--success-bg);
    color: var(--success);
  }
  .link-subtask {
    background: var(--warning-bg);
    color: var(--warning);
  }
  .link-claim {
    background: var(--accent-bg);
    color: var(--accent-text);
  }
</style>
