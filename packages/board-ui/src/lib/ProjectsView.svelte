<script lang="ts">
  // "Manage projects" modal — lists every registered project with its
  // path, lets the user reveal it in Finder, switch to it, or remove
  // the registry entry. Add-existing / create flows are reachable from
  // here too via the existing CreateProjectDialog.
  import { onMount } from "svelte";
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

  async function rename(project: ProjectEntry) {
    const next = prompt(t("manage_projects.rename_prompt", { name: project.name }), project.name);
    if (!next || !next.trim() || next === project.name) return;
    renamingId = project.id;
    try {
      await renameProjectById(project.id, next.trim());
      await load();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      renamingId = null;
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

  function openInFinder(path: string) {
    if (typeof window !== "undefined" && (window as unknown as { backlog?: { openPath(p: string): Promise<unknown> } }).backlog) {
      (window as unknown as { backlog: { openPath(p: string): Promise<unknown> } }).backlog.openPath(path).catch(() => undefined);
    } else {
      navigator.clipboard?.writeText(path).catch(() => undefined);
    }
  }

  function pickAndClose(id: string) {
    onSelect(id);
    onClose();
  }

  onMount(() => { void load(); });
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
            <li class:current={isCurrent}>
              <div class="info">
                <div class="row1">
                  <button class="name-btn" onclick={() => pickAndClose(project.id)}>
                    <strong>{project.name}</strong>
                    {#if isCurrent}<span class="badge">{t("manage_projects.current")}</span>{/if}
                  </button>
                  <span class="loc-pill">{project.location === "user_level" ? "user-level" : "in-repo"}</span>
                </div>
                <button class="path-link" onclick={() => openInFinder(project.path)} title={t("repos_view.open_folder")}>
                  📂 <span class="path-text">{project.path}</span>
                </button>
              </div>
              <div class="actions">
                <button
                  class="ghost"
                  onclick={() => rename(project)}
                  disabled={renamingId === project.id}
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
  .close {
    background: transparent; border: none;
    font-size: 18px; cursor: pointer;
    color: var(--text-secondary);
  }
  .error {
    background: var(--danger-bg); color: var(--danger);
    padding: 8px 20px; font-size: 12px;
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
  }
  .name-btn:hover { color: var(--accent); }
  .badge {
    background: var(--accent-bg); color: var(--accent-text);
    font-size: 10px; padding: 1px 6px; border-radius: 10px;
    font-weight: 500;
  }
  .loc-pill {
    background: var(--bg-hover); color: var(--text-body);
    padding: 1px 8px; border-radius: 10px;
    font-size: 11px; font-weight: 500;
  }
  .path-link {
    background: transparent; border: none; padding: 0;
    text-align: left; cursor: pointer;
    color: var(--text-secondary); font-size: 11px;
    font-family: ui-monospace, monospace;
    display: inline-flex; align-items: center; gap: 4px;
    overflow: hidden; min-width: 0;
  }
  .path-link:hover { color: var(--accent); }
  .path-text {
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .actions { flex-shrink: 0; display: flex; gap: 6px; }
  button.ghost {
    background: transparent;
    border: 1px solid var(--border-strong);
    color: var(--text-secondary);
    border-radius: 4px;
    padding: 4px 10px;
    font-size: 12px;
    cursor: pointer;
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
</style>
