<script lang="ts">
  import { t } from "./i18n.svelte.js";
  import type { Repo } from "./types.js";

  interface Props {
    repos: Repo[];
    selectedId: string | null;
    projectScoped: boolean;
    onSelect: (id: string | null) => void;
    onManage: () => void;
  }

  let { repos, selectedId, projectScoped, onSelect, onManage }: Props = $props();

  function handleChange(event: Event) {
    const target = event.currentTarget as HTMLSelectElement;
    onSelect(target.value || null);
  }

  const allLabel = $derived(t("selector.all_repos", { count: repos.length }));
</script>

<div class="repository-selector">
  <select value={selectedId ?? ""} onchange={handleChange} disabled={repos.length === 0}>
    <option value="">{allLabel}</option>
    {#each repos as repo (repo.id)}
      <option value={repo.id} disabled={!repo.enabled}>
        {repo.id}
      </option>
    {/each}
  </select>
  <button class="manage" onclick={onManage} title={t("selector.manage")}>📁</button>
</div>

<style>
  .repository-selector {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  select {
    background: var(--bg-surface);
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 13px;
    color: var(--text-primary);
    cursor: pointer;
    max-width: 180px;
    text-overflow: ellipsis;
  }
  select:hover:not(:disabled) {
    border-color: var(--text-subtle);
  }
  select:disabled {
    background: var(--bg-muted);
    color: var(--text-subtle);
    cursor: not-allowed;
  }
  .manage {
    background: transparent;
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    padding: 2px 6px;
    cursor: pointer;
    font-size: 12px;
    color: var(--text-secondary);
  }
  .manage:hover {
    background: var(--bg-hover);
  }
</style>
