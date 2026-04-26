<script lang="ts">
  import type { Project } from "./types.js";

  interface Props {
    projects: Project[];
    selectedId: string | null;
    onSelect: (id: string | null) => void;
    onManage: () => void;
  }

  let { projects, selectedId, onSelect, onManage }: Props = $props();

  function handleChange(event: Event) {
    const target = event.currentTarget as HTMLSelectElement;
    onSelect(target.value || null);
  }
</script>

<div class="project-selector">
  <select value={selectedId ?? ""} onchange={handleChange}>
    <option value="">Tous les projets</option>
    {#each projects.filter((p) => !p.archived) as project (project.id)}
      <option value={project.id}>{project.name}</option>
    {/each}
  </select>
  <button class="manage" onclick={onManage} title="Gérer les projets">⚙</button>
</div>

<style>
  .project-selector {
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
  }
  select:hover {
    border-color: #98a2b3;
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
