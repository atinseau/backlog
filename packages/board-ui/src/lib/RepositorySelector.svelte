<script lang="ts">
  // Custom repository switcher — same shape as ProjectSelector so the
  // two dropdowns feel consistent. Filter the kanban by repository, or
  // pick "All repositories" to remove the filter. Footer items create
  // / manage repositories without leaving the panel.
  import { onDestroy } from "svelte";
  import { t } from "./i18n.svelte.js";
  import { isMissingRepoPathError } from "./repo-relocate.js";
  import type { GitStatusSummary, Repo } from "./types.js";

  interface Props {
    repos: Repo[];
    selectedId: string | null;
    projectScoped: boolean;
    onSelect: (id: string | null) => void;
    onManage: () => void;
    onCreate?: () => void;
    gitStatuses?: Record<string, GitStatusSummary>;
  }

  let { repos, selectedId, onSelect, onManage, onCreate, gitStatuses = {} }: Props = $props();

  let open = $state(false);
  let containerEl = $state<HTMLDivElement | null>(null);

  const selected = $derived(repos.find((r) => r.id === selectedId) ?? null);
  const triggerLabel = $derived(
    selected ? selected.id : t("selector.all_repos", { count: repos.length }),
  );
  const aggregateStatus = $derived(aggregateGitStatus(repos, gitStatuses));
  const selectedStatus = $derived(selected ? gitStatuses[selected.id] : aggregateStatus);

  function emptyStatus(): GitStatusSummary {
    return {
      clean: true,
      total: 0,
      added: 0,
      modified: 0,
      deleted: 0,
      renamed: 0,
      untracked: 0,
      conflicted: 0,
      staged: 0,
      unstaged: 0,
    };
  }

  function aggregateGitStatus(items: Repo[], statuses: Record<string, GitStatusSummary>): GitStatusSummary {
    const total = emptyStatus();
    for (const repo of items) {
      const status = statuses[repo.id];
      if (!status) continue;
      if (status.error && !total.error) total.error = status.error;
      total.added += status.added;
      total.modified += status.modified;
      total.deleted += status.deleted;
      total.renamed += status.renamed;
      total.untracked += status.untracked;
      total.conflicted += status.conflicted;
      total.staged += status.staged;
      total.unstaged += status.unstaged;
      total.total += status.total;
    }
    total.clean = total.total === 0;
    return total;
  }

  function statusPart(key: keyof GitStatusSummary, labelKey: string, status: GitStatusSummary): string | null {
    const count = status[key];
    return typeof count === "number" && count > 0 ? t(labelKey, { count }) : null;
  }

  function statusTitle(status: GitStatusSummary | undefined): string {
    if (!status) return t("git_status.unknown");
    if (isMissingRepoPathError(status.error)) return t("git_status.missing_repo");
    if (status.error) return t("git_status.unavailable");
    if (status.total === 0) return t("git_status.clean");
    return [
      statusPart("added", "git_status.added", status),
      statusPart("modified", "git_status.modified", status),
      statusPart("deleted", "git_status.deleted", status),
      statusPart("renamed", "git_status.renamed", status),
      statusPart("untracked", "git_status.untracked", status),
      statusPart("conflicted", "git_status.conflicted", status),
    ].filter((part): part is string => Boolean(part)).join(", ");
  }

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
    {#if selectedStatus?.error}
      <span class="dirty-badge" title={statusTitle(selectedStatus)} aria-label={statusTitle(selectedStatus)}>
        !
      </span>
    {:else if selectedStatus && selectedStatus.total > 0}
      <span class="dirty-badge" title={statusTitle(selectedStatus)} aria-label={statusTitle(selectedStatus)}>
        {selectedStatus.total}
      </span>
    {/if}
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
        {#if aggregateStatus.error}
          <span class="dirty-badge" title={statusTitle(aggregateStatus)} aria-label={statusTitle(aggregateStatus)}>
            !
          </span>
        {:else if aggregateStatus.total > 0}
          <span class="dirty-badge" title={statusTitle(aggregateStatus)} aria-label={statusTitle(aggregateStatus)}>
            {aggregateStatus.total}
          </span>
        {/if}
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
            {#if gitStatuses[repo.id]?.error}
              <span class="dirty-badge" title={statusTitle(gitStatuses[repo.id])} aria-label={statusTitle(gitStatuses[repo.id])}>
                !
              </span>
            {:else if gitStatuses[repo.id]?.total > 0}
              <span class="dirty-badge" title={statusTitle(gitStatuses[repo.id])} aria-label={statusTitle(gitStatuses[repo.id])}>
                {gitStatuses[repo.id].total}
              </span>
            {/if}
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
  .dirty-badge {
    flex: 0 0 auto;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--warning-bg);
    color: var(--warning);
    border: 1px solid color-mix(in srgb, var(--warning) 34%, transparent);
    font-size: 11px;
    font-weight: 700;
    line-height: 1;
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
