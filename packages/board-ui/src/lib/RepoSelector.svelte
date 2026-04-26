<script lang="ts">
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

  const allLabel = $derived(
    projectScoped
      ? `Repos du projet (${repos.length})`
      : `Tous les repos (${repos.length})`,
  );
</script>

<div class="repo-selector">
  <select value={selectedId ?? ""} onchange={handleChange} disabled={repos.length === 0}>
    <option value="">{allLabel}</option>
    {#each repos as repo (repo.id)}
      <option value={repo.id} disabled={!repo.enabled}>
        {repo.id}{repo.enabled ? "" : " (désactivé)"}
      </option>
    {/each}
  </select>
  <button class="manage" onclick={onManage} title="Gérer les repos">📁</button>
</div>

<style>
  .repo-selector {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  select {
    background: white;
    border: 1px solid #d0d5dd;
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 13px;
    color: #1d2939;
    cursor: pointer;
    max-width: 180px;
    text-overflow: ellipsis;
  }
  select:hover:not(:disabled) {
    border-color: #98a2b3;
  }
  select:disabled {
    background: #f9fafb;
    color: #98a2b3;
    cursor: not-allowed;
  }
  .manage {
    background: transparent;
    border: 1px solid #d0d5dd;
    border-radius: 4px;
    padding: 2px 6px;
    cursor: pointer;
    font-size: 12px;
    color: #475467;
  }
  .manage:hover {
    background: #f2f4f7;
  }
</style>
