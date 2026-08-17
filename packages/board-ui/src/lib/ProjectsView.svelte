<script lang="ts">
  // "Manage projects" modal — lists every registered project with its
  // path, lets the user reveal it in Finder, switch to it, or remove
  // the registry entry. Add-existing / create flows are reachable from
  // here too via the existing CreateProjectDialog.
  import { onDestroy, onMount } from "svelte";
  import { t } from "./i18n.svelte.js";
  import {
    fetchProjectsList,
    unregisterProjectById,
    renameProjectById,
    type CurrentProject,
    fetchCurrentProject,
  } from "./api.js";
  import type { ProjectEntry } from "./types.js";

  interface Props {
    onClose: () => void;
    onSelect: (id: string) => void;
    onCreateProject: () => void;
  }

  let { onClose, onSelect, onCreateProject }: Props = $props();

  let projects = $state<ProjectEntry[]>([]);
  let current = $state<CurrentProject | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let removingId = $state<string | null>(null);
  let renamingId = $state<string | null>(null);
  // Inline edit mode — replace the project name with a text input, so the
  // rename flow lives inside the modal rather than in a window.prompt().
  let editingId = $state<string | null>(null);
  let editValue = $state("");
  let contextMenu = $state<{ x: number; y: number; items: Array<{ label: string; action: () => void; disabled?: boolean }> } | null>(null);

  function focusOnMount(node: HTMLElement): void {
    queueMicrotask(() => node.focus());
  }

  async function load() {
    loading = true;
    try {
      const [list, cur] = await Promise.all([
        fetchProjectsList(),
        fetchCurrentProject().catch(() => null),
      ]);
      projects = list;
      current = cur;
      error = null;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }

  function startEdit(project: ProjectEntry) {
    editingId = project.id;
    editValue = project.name;
  }
  function cancelEdit() {
    editingId = null;
    editValue = "";
  }
  async function commitEdit(project: ProjectEntry) {
    const next = editValue.trim();
    if (!next || next === project.name) {
      cancelEdit();
      return;
    }
    renamingId = project.id;
    editingId = null;
    try {
      await renameProjectById(project.id, next);
      await load();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      renamingId = null;
    }
  }
  function handleEditKey(event: KeyboardEvent, project: ProjectEntry) {
    if (event.key === "Enter") {
      event.preventDefault();
      void commitEdit(project);
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancelEdit();
    }
  }

  async function remove(project: ProjectEntry) {
    if (!confirm(t("manage_projects.remove_confirm", { name: project.name }))) return;
    removingId = project.id;
    try {
      await unregisterProjectById(project.id);
      await load();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      removingId = null;
    }
  }

  // Served in a browser, so "open" means putting the path on the clipboard.
  function openPath(path: string) {
    navigator.clipboard?.writeText(path).catch(() => undefined);
  }

  const revealPath = openPath;
  const openEditor = openPath;

  function showContextMenu(event: MouseEvent, project: ProjectEntry) {
    event.preventDefault();
    event.stopPropagation();
    const width = 220;
    const height = 74;
    contextMenu = {
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8)),
      items: [
        { label: t("context.open_editor"), action: () => openEditor(project.path) },
        { label: t("context.reveal_finder"), action: () => revealPath(project.path) },
      ],
    };
  }

  function closeContextMenu() {
    contextMenu = null;
  }

  function pickAndClose(id: string) {
    onSelect(id);
    onClose();
  }

  onMount(() => {
    void load();
    window.addEventListener("click", closeContextMenu);
  });
  onDestroy(() => {
    window.removeEventListener("click", closeContextMenu);
  });
</script>

<div class="backdrop" onclick={onClose} role="presentation">
  <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex={-1} onkeydown={(e) => { if (e.key === "Escape") onClose(); }}>
    <header>
      <h2>{t("manage_projects.title")}</h2>
      <button class="close" onclick={onClose}>✕</button>
    </header>

    {#if error}
      <div class="error">{error}</div>
    {/if}

    <div class="content">
      {#if loading}
        <div class="loading">…</div>
      {:else if projects.length === 0}
        <p class="empty">{t("manage_projects.empty")}</p>
      {:else}
        <ul class="projects">
          {#each projects as project (project.id)}
            {@const isCurrent = current?.root === project.path}
            <li class:current={isCurrent} oncontextmenu={(e) => showContextMenu(e, project)}>
              <div class="info">
                <div class="row1">
                  {#if editingId === project.id}
                    <input
                      class="rename-input"
                      type="text"
                      bind:value={editValue}
                      onkeydown={(e) => handleEditKey(e, project)}
                      onblur={() => commitEdit(project)}
                      use:focusOnMount
                    />
                  {:else}
                    <button
                      class="name-btn"
                      onclick={() => pickAndClose(project.id)}
                      ondblclick={(e) => { e.stopPropagation(); startEdit(project); }}
                      title={t("manage_projects.dblclick_rename")}
                    >
                      <strong>{project.name}</strong>
                      {#if isCurrent}<span class="badge">{t("manage_projects.current")}</span>{/if}
                    </button>
                  {/if}
                  <span class="loc-pill">{project.location === "user_level" ? t("manage_projects.location.user_level") : t("manage_projects.location.project_folder")}</span>
                </div>
                <button class="path-link" onclick={() => revealPath(project.path)} title={t("repos_view.open_folder")}>
                  📂 <span class="path-text">{project.path}</span>
                </button>
              </div>
              <div class="actions">
                <button
                  class="ghost"
                  onclick={() => startEdit(project)}
                  disabled={renamingId === project.id || editingId === project.id}
                  title={t("manage_projects.rename")}
                >
                  {renamingId === project.id ? "…" : "✎ " + t("manage_projects.rename")}
                </button>
                <button
                  class="danger"
                  onclick={() => remove(project)}
                  disabled={removingId === project.id || isCurrent}
                  title={isCurrent ? t("manage_projects.cannot_remove_current") : t("manage_projects.remove")}
                >
                  {removingId === project.id ? "…" : t("manage_projects.remove")}
                </button>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    <footer class="footer">
      <button class="primary" onclick={() => { onClose(); onCreateProject(); }}>
        + {t("selector.new_project_short")}
      </button>
    </footer>
  </div>
</div>

{#if contextMenu}
  <div
    class="context-menu"
    style:left={`${contextMenu.x}px`}
    style:top={`${contextMenu.y}px`}
    role="menu"
    tabindex="-1"
    oncontextmenu={(e) => e.preventDefault()}
  >
    {#each contextMenu.items as item}
      <button type="button" role="menuitem" disabled={item.disabled} onclick={() => { closeContextMenu(); item.action(); }}>
        {item.label}
      </button>
    {/each}
  </div>
{/if}

<style>
  .backdrop {
    position: fixed; inset: 0;
    background: var(--backdrop);
    display: flex; align-items: center; justify-content: center;
    z-index: 100;
  }
  .modal {
    background: var(--bg-surface);
    color: var(--text-primary);
    border-radius: 8px;
    box-shadow: var(--shadow-modal);
    max-width: 640px; width: 92%;
    max-height: 80vh;
    display: flex; flex-direction: column; overflow: hidden;
  }
  header {
    padding: 16px 20px;
    border-bottom: 1px solid var(--border-default);
    display: flex; align-items: center; justify-content: space-between;
  }
  h2 { margin: 0; font-size: 16px; }
  /* WCAG 2.5.8: the glyph is 18px but the target floors at --tap-size. */
  .close {
    background: transparent; border: none;
    font-size: 18px; cursor: pointer;
    color: var(--text-secondary);
    min-width: var(--tap-size); min-height: var(--tap-size);
    display: inline-flex; align-items: center; justify-content: center;
    border-radius: 4px;
  }
  .close:hover { background: var(--bg-hover); color: var(--text-primary); }
  .error {
    background: var(--danger-bg); color: var(--danger);
    padding: 8px 20px; font-size: 12px;
  }
  .context-menu {
    position: fixed;
    z-index: 1000;
    min-width: 210px;
    padding: 4px;
    border: 1px solid var(--border-default);
    border-radius: 6px;
    background: var(--bg-elevated);
    box-shadow: var(--shadow-modal);
    display: flex;
    flex-direction: column;
  }
  .context-menu button {
    width: 100%;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--text-primary);
    padding: 7px 9px;
    font: inherit;
    font-size: 12px;
    text-align: left;
    cursor: pointer;
  }
  .context-menu button:hover:not(:disabled),
  .context-menu button:focus-visible {
    background: var(--bg-hover);
  }
  .content {
    flex: 1; overflow-y: auto;
    padding: 12px 16px;
  }
  .empty {
    text-align: center; color: var(--text-muted);
    padding: 24px 0; font-style: italic;
  }
  .loading { padding: 24px; text-align: center; color: var(--text-muted); }

  .projects {
    list-style: none; padding: 0; margin: 0;
    display: flex; flex-direction: column; gap: 8px;
  }
  .projects li {
    display: flex; align-items: center; gap: 12px;
    padding: 10px 12px;
    border: 1px solid var(--border-default);
    border-radius: 6px;
    background: var(--bg-elevated);
  }
  .projects li.current {
    border-color: var(--accent);
  }
  .info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
  .row1 { display: flex; align-items: center; gap: 8px; }
  .name-btn {
    background: transparent; border: none;
    padding: 0; cursor: pointer;
    text-align: left;
    color: var(--text-primary); font-size: 14px;
    display: inline-flex; align-items: center; gap: 6px;
    min-height: var(--tap-size);
  }
  .name-btn:hover { color: var(--accent); }
  .rename-input {
    flex: 0 0 auto;
    min-width: 200px;
    background: var(--bg-input);
    border: 1px solid var(--accent);
    color: var(--text-primary);
    border-radius: 4px;
    padding: 3px 8px;
    font-size: 14px;
    font-weight: 600;
    font-family: inherit;
    min-height: var(--tap-size);
  }
  /* Was `outline: none` with no replacement — the accent border is
     permanent here, so it never signalled focus. */
  .rename-input:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .badge {
    background: var(--accent-bg); color: var(--accent-text);
    font-size: 10px; padding: 1px 6px; border-radius: 999px;
    text-transform: uppercase; letter-spacing: 0.04em;
    font-weight: 500;
  }
  .loc-pill {
    background: var(--bg-hover); color: var(--text-body);
    padding: 1px 8px; border-radius: 999px;
    font-size: 11px; font-weight: 500;
  }
  .path-link {
    background: transparent; border: none; padding: 0;
    text-align: left; cursor: pointer;
    color: var(--text-secondary); font-size: 11px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    display: inline-flex; align-items: center; gap: 4px;
    overflow: hidden; min-width: 0;
    min-height: var(--tap-size);
  }
  .path-link:hover { color: var(--accent); }
  .path-text {
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .actions { flex-shrink: 0; display: flex; gap: 6px; }
  button.ghost {
    background: transparent;
    /* Transparent control on a surface: WCAG 1.4.11 asks 3:1. */
    border: 1px solid var(--border-field);
    color: var(--text-secondary);
    border-radius: 4px;
    padding: 4px 10px;
    font-size: 12px;
    cursor: pointer;
    min-height: var(--tap-size);
  }
  button.ghost:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  button.ghost:disabled { opacity: 0.4; cursor: not-allowed; }
  button.danger {
    background: transparent;
    border: 1px solid var(--danger);
    color: var(--danger);
    border-radius: 4px;
    padding: 4px 10px;
    font-size: 12px;
    cursor: pointer;
    min-height: var(--tap-size);
  }
  button.danger:hover:not(:disabled) {
    background: var(--danger-bg);
  }
  button.danger:disabled {
    opacity: 0.4; cursor: not-allowed;
  }

  .footer {
    padding: 12px 16px;
    border-top: 1px solid var(--border-default);
    display: flex; justify-content: flex-end;
  }
  button.primary {
    background: var(--accent); color: var(--accent-on);
    border: 1px solid var(--accent);
    border-radius: 4px;
    padding: 6px 14px;
    font-size: 13px; font-weight: 500;
    cursor: pointer;
  }
  button.primary:hover { background: var(--accent-hover); }

  /* BP_NARROW — src/lib/shell/breakpoints.ts */
  @media (max-width: 640px) {
    .projects li {
      flex-direction: column;
      align-items: stretch;
    }
    .actions { justify-content: flex-end; }
    .row1 { flex-wrap: wrap; }
  }
</style>
