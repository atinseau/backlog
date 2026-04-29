<script lang="ts">
  // Custom repository switcher — same shape as ProjectSelector so the
  // two dropdowns feel consistent. Filter the kanban by repository, or
  // pick "All repositories" to remove the filter. Footer items create
  // / manage repositories without leaving the panel.
  import { onDestroy } from "svelte";
  import { t } from "./i18n.svelte.js";
  import type { Repo } from "./types.js";

  interface Props {
    repos: Repo[];
    selectedId: string | null;
    projectScoped: boolean;
    onSelect: (id: string | null) => void;
    onManage: () => void;
    onCreate?: () => void;
  }

  let { repos, selectedId, onSelect, onManage, onCreate }: Props = $props();

  let open = $state(false);
  let containerEl = $state<HTMLDivElement | null>(null);

  const selected = $derived(repos.find((r) => r.id === selectedId) ?? null);
  const triggerLabel = $derived(
    selected ? selected.id : t("selector.all_repos", { count: repos.length }),
  );

  function toggle() { open = !open; }
  function close() { open = false; }

  function handleDocumentClick(e: MouseEvent) {
    if (!open) return;
    if (containerEl && !containerEl.contains(e.target as Node)) close();
  }
  function handleKey(e: KeyboardEvent) {
    if (open && e.key === "Escape") close();
  }
  $effect(() => {
    if (open) {
      window.addEventListener("click", handleDocumentClick);
      window.addEventListener("keydown", handleKey);
    } else {
      window.removeEventListener("click", handleDocumentClick);
      window.removeEventListener("keydown", handleKey);
    }
  });
  onDestroy(() => {
    window.removeEventListener("click", handleDocumentClick);
    window.removeEventListener("keydown", handleKey);
  });

  function pick(id: string | null) {
    close();
    onSelect(id);
  }
</script>

<div class="repository-selector" bind:this={containerEl}>
  <button
    class="trigger"
    type="button"
    onclick={toggle}
    aria-haspopup="listbox"
    aria-expanded={open}
  >
    <span class="repo-icon" aria-hidden="true">📦</span>
    <span class="name">{triggerLabel}</span>
    <span class="chevron" aria-hidden="true">▾</span>
  </button>

  {#if open}
    <div class="menu" role="listbox">
      <button
        class="item"
        class:active={selectedId === null}
        onclick={() => pick(null)}
      >
        <span class="item-name">{t("selector.all_repos", { count: repos.length })}</span>
        {#if selectedId === null}<span class="check">✓</span>{/if}
      </button>
      {#if repos.length > 0}
        <div class="separator"></div>
        {#each repos as repo (repo.id)}
          <button
            class="item"
            class:active={selectedId === repo.id}
            class:dim={!repo.enabled}
            disabled={!repo.enabled}
            onclick={() => pick(repo.id)}
          >
            <span class="item-name">{repo.id}</span>
            {#if !repo.enabled}<span class="off">disabled</span>{/if}
            {#if selectedId === repo.id}<span class="check">✓</span>{/if}
          </button>
        {/each}
      {/if}
      <div class="separator"></div>
      {#if onCreate}
        <button class="item action" onclick={() => { close(); onCreate?.(); }}>
          <span class="item-name">+ {t("selector.new_repository")}</span>
        </button>
      {/if}
      <button class="item action" onclick={() => { close(); onManage(); }}>
        <span class="item-name">⚙ {t("selector.manage_repositories")}</span>
      </button>
    </div>
  {/if}
</div>

<style>
  .repository-selector {
    position: relative;
    display: inline-flex;
  }
  .trigger {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: var(--bg-input);
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    padding: 4px 8px;
    cursor: pointer;
    font: inherit;
    font-size: 13px;
    color: var(--text-primary);
    width: 100%;
  }
  .trigger:hover:not(:disabled) {
    border-color: var(--accent);
  }
  .trigger:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .repo-icon { font-size: 12px; flex-shrink: 0; }
  .name {
    flex: 1; min-width: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    text-align: left;
  }
  .chevron {
    font-size: 14px;
    color: var(--text-muted);
    line-height: 1;
    flex-shrink: 0;
  }

  .menu {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    right: 0;
    min-width: 220px;
    background: var(--bg-surface);
    border: 1px solid var(--border-default);
    border-radius: 6px;
    box-shadow: var(--shadow-modal);
    padding: 4px;
    z-index: 60;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 8px;
    background: transparent;
    border: none;
    padding: 6px 10px;
    border-radius: 4px;
    cursor: pointer;
    text-align: left;
    color: var(--text-body);
    font-size: 13px;
    width: 100%;
  }
  .item:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .item.active {
    color: var(--text-primary);
    font-weight: 500;
  }
  .item.dim { opacity: 0.55; }
  .item:disabled { cursor: not-allowed; }
  .item-name {
    flex: 1;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .check {
    color: var(--accent);
    font-size: 12px;
    flex-shrink: 0;
  }
  .off {
    font-size: 10px;
    color: var(--text-muted);
    background: var(--bg-hover);
    padding: 1px 5px;
    border-radius: 8px;
  }
  .item.action {
    color: var(--text-secondary);
    font-size: 12.5px;
  }
  .separator {
    height: 1px;
    background: var(--border-subtle);
    margin: 4px 0;
  }
</style>
