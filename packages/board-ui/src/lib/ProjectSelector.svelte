<script lang="ts">
  // Custom project switcher — replaces the native <select> so we can:
  //   * Drop the framing border + home glyph for a cleaner topbar look.
  //   * Append a "Manage projects" footer item below the project list
  //     (something a <select> can't host).
  // Click outside / Escape dismisses; the active project is marked with
  // a check on the right.
  import { onDestroy } from "svelte";
  import { t } from "./i18n.svelte.js";
  import type { ProjectEntry } from "./types.js";

  interface Props {
    projects: ProjectEntry[];
    selectedId: string | null;
    onSelect: (id: string) => void;
    onCreateProject?: () => void;
    onManageProjects?: () => void;
  }

  let { projects, selectedId, onSelect, onCreateProject, onManageProjects }: Props = $props();

  let open = $state(false);
  let containerEl = $state<HTMLDivElement | null>(null);

  const selected = $derived(projects.find((p) => p.id === selectedId) ?? null);

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

  function pick(id: string) {
    close();
    if (id !== selectedId) onSelect(id);
  }
</script>

<div class="project-selector" bind:this={containerEl}>
  <button
    class="trigger"
    type="button"
    onclick={toggle}
    aria-haspopup="listbox"
    aria-expanded={open}
    title={selected?.path ?? ""}
  >
    <span class="name">{selected?.name ?? t("selector.no_project")}</span>
    <span class="chevron" aria-hidden="true">▾</span>
  </button>

  {#if open}
    <div class="menu" role="listbox">
      {#each projects as project (project.id)}
        <button
          class="item"
          class:active={project.id === selectedId}
          role="option"
          aria-selected={project.id === selectedId}
          onclick={() => pick(project.id)}
        >
          <span class="item-name">{project.name}</span>
          {#if project.id === selectedId}<span class="check">✓</span>{/if}
        </button>
      {/each}

      {#if onCreateProject || onManageProjects}
        <div class="separator"></div>
      {/if}
      {#if onCreateProject}
        <button class="item action" onclick={() => { close(); onCreateProject?.(); }}>
          <span class="item-name">+ {t("selector.new_project_short")}</span>
        </button>
      {/if}
      {#if onManageProjects}
        <button class="item action" onclick={() => { close(); onManageProjects?.(); }}>
          <span class="item-name">⚙ {t("selector.manage_projects")}</span>
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .project-selector {
    position: relative;
    display: inline-flex;
  }
  .trigger {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: transparent;
    border: none;
    padding: 4px 8px;
    border-radius: 4px;
    cursor: pointer;
    font: inherit;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
  }
  .trigger:hover {
    background: var(--bg-hover);
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 200px;
  }
  .chevron {
    font-size: 14px;
    color: var(--text-muted);
    line-height: 1;
    margin-left: 2px;
  }

  .menu {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
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
  .item:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .item.active {
    color: var(--text-primary);
    font-weight: 500;
  }
  .item-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .check {
    color: var(--accent);
    font-size: 12px;
    flex-shrink: 0;
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
