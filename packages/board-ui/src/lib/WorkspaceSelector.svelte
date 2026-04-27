<script lang="ts">
  import type { WorkspaceEntry } from "./types.js";

  interface Props {
    workspaces: WorkspaceEntry[];
    selectedId: string | null;
    onSelect: (id: string) => void;
  }

  let { workspaces, selectedId, onSelect }: Props = $props();

  function handleChange(event: Event) {
    const target = event.currentTarget as HTMLSelectElement;
    if (target.value) onSelect(target.value);
  }

  // If only one workspace is registered we still show the selector so the
  // user knows where they are, but disable it — there's nowhere else to go.
  const disabled = $derived(workspaces.length <= 1);
</script>

<div class="workspace-selector" class:single={disabled}>
  <span class="label">⌂</span>
  <select value={selectedId ?? ""} onchange={handleChange} {disabled}>
    {#each workspaces as workspace (workspace.id)}
      <option value={workspace.id}>{workspace.name}</option>
    {/each}
  </select>
</div>

<style>
  .workspace-selector {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    background: #f9fafb;
    border: 1px solid #d0d5dd;
    border-radius: 4px;
  }
  .workspace-selector.single {
    background: transparent;
    border-color: transparent;
  }
  .label {
    font-size: 13px;
    color: #475467;
  }
  select {
    background: transparent;
    border: none;
    padding: 2px 0;
    font-size: 13px;
    color: #1d2939;
    cursor: pointer;
    font-weight: 500;
  }
  select:disabled {
    cursor: default;
  }
  select:hover:not(:disabled) {
    color: #155eef;
  }
</style>
