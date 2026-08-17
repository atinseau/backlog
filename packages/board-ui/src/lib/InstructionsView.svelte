<script lang="ts">
  import { fetchInstructions, type InstructionFile } from "./api.js";
  import { t } from "./i18n.svelte.js";

  interface Props {
    embedded?: boolean;
    onClose: () => void;
  }

  let { embedded = false, onClose }: Props = $props();

  let files = $state<InstructionFile[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let selectedPath = $state<string | null>(null);

  const selected = $derived(files.find((file) => file.path === selectedPath) ?? files[0] ?? null);

  // Served in a browser, so "open" means putting the path on the clipboard.
  function openPath(path: string) {
    navigator.clipboard?.writeText(path).catch(() => undefined);
  }

  const revealPath = openPath;
  const openEditor = openPath;

  function scopeLabel(file: InstructionFile): string {
    return file.scope === "project"
      ? t("instructions.scope.project")
      : t("instructions.scope.repository", { repository: file.repository_name ?? file.repository_id ?? "" });
  }

  function formatBytes(size: number): string {
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }

  async function load() {
    loading = true;
    try {
      const response = await fetchInstructions();
      files = response.files;
      if (!selectedPath || !response.files.some((file) => file.path === selectedPath)) {
        selectedPath = response.files[0]?.path ?? null;
      }
      error = null;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }

  load();
</script>

{#snippet body()}
  <header class="view-header">
    <div>
      <h2>{t("instructions.title")}</h2>
      <p>{t("instructions.subtitle")}</p>
    </div>
    <div class="header-actions">
      <button type="button" onclick={load} disabled={loading}>{loading ? "…" : t("common.refresh")}</button>
      {#if !embedded}<button class="close" onclick={onClose}>✕</button>{/if}
    </div>
  </header>

  {#if error}
    <div class="error">{error}</div>
  {/if}

  {#if loading}
    <div class="loading">…</div>
  {:else if files.length === 0}
    <div class="empty">{t("instructions.empty")}</div>
  {:else}
    <div class="layout">
      <aside class="file-list" aria-label={t("instructions.files")}>
        {#each files as file (file.path)}
          <button
            type="button"
            class="file-row"
            class:active={selected?.path === file.path}
            onclick={() => (selectedPath = file.path)}
          >
            <strong>{file.name}</strong>
            <span>{scopeLabel(file)}</span>
            <small>{file.relative_path}</small>
          </button>
        {/each}
      </aside>

      {#if selected}
        <section class="reader">
          <div class="reader-head">
            <div>
              <span class="scope">{scopeLabel(selected)}</span>
              <h3>{selected.relative_path}</h3>
              <small>{selected.path}</small>
            </div>
            <div class="reader-actions">
              <button type="button" onclick={() => openEditor(selected.path)}>{t("context.open_editor")}</button>
              <button type="button" onclick={() => revealPath(selected.path)}>{t("context.reveal_finder")}</button>
            </div>
          </div>
          <div class="file-meta">
            <span>{formatBytes(selected.size_bytes)}</span>
            <span>{new Date(selected.updated_at).toLocaleString()}</span>
            {#if selected.truncated}<span>{t("instructions.truncated")}</span>{/if}
          </div>
          <pre>{selected.content}</pre>
        </section>
      {/if}
    </div>
  {/if}
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
    width: min(1040px, 94vw);
    height: min(760px, 88vh);
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
    gap: 14px;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border-default);
  }
  .view-header h2 {
    margin: 0;
    font-size: 20px;
  }
  .view-header p {
    margin: 4px 0 0;
    color: var(--text-muted);
    font-size: 13px;
  }
  .header-actions,
  .reader-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  button {
    border: 1px solid var(--border-strong);
    border-radius: 5px;
    background: var(--bg-input);
    color: var(--text-primary);
    font: inherit;
    cursor: pointer;
    padding: 6px 10px;
  }
  button:disabled {
    opacity: 0.55;
    cursor: default;
  }
  .close {
    border: none;
    background: transparent;
    color: var(--text-secondary);
    font-size: 18px;
  }
  .error {
    margin: 12px 20px 0;
    color: var(--danger);
    background: var(--danger-bg);
    border: 1px solid color-mix(in srgb, var(--danger) 35%, transparent);
    border-radius: 6px;
    padding: 8px 10px;
    font-size: 12px;
  }
  .loading,
  .empty {
    padding: 32px;
    color: var(--text-muted);
    text-align: center;
  }
  .layout {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 300px minmax(0, 1fr);
  }
  .file-list {
    border-right: 1px solid var(--border-default);
    background: var(--bg-muted);
    overflow: auto;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .file-row {
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 3px;
    text-align: left;
    border: none;
    background: transparent;
    padding: 8px 10px;
  }
  .file-row:hover {
    background: var(--bg-hover);
  }
  .file-row.active {
    background: var(--accent-bg);
    color: var(--accent-text);
  }
  .file-row strong,
  .file-row span,
  .file-row small {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .file-row span {
    color: var(--text-secondary);
    font-size: 12px;
  }
  .file-row small {
    color: var(--text-muted);
    font-family: ui-monospace, monospace;
    font-size: 11px;
  }
  .reader {
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .reader-head {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    padding: 14px 18px;
    border-bottom: 1px solid var(--border-subtle);
  }
  .reader-head h3 {
    margin: 3px 0;
    font-size: 16px;
  }
  .reader-head small {
    color: var(--text-muted);
    font-family: ui-monospace, monospace;
    font-size: 11px;
  }
  .scope {
    color: var(--accent-text);
    font-size: 12px;
  }
  .file-meta {
    display: flex;
    gap: 12px;
    padding: 8px 18px;
    border-bottom: 1px solid var(--border-subtle);
    color: var(--text-muted);
    font-size: 11px;
  }
  pre {
    flex: 1;
    min-height: 0;
    margin: 0;
    overflow: auto;
    padding: 16px 18px;
    background: var(--bg-surface);
    color: var(--text-primary);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 12px;
    line-height: 1.55;
    white-space: pre-wrap;
    word-break: break-word;
  }
  @media (max-width: 820px) {
    .layout {
      grid-template-columns: 1fr;
    }
    .file-list {
      max-height: 220px;
      border-right: none;
      border-bottom: 1px solid var(--border-default);
    }
    .reader-head {
      flex-direction: column;
    }
  }
</style>
