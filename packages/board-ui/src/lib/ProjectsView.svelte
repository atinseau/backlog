<script lang="ts">
  import { createProject, deleteProject, fetchProjects, updateProject } from "./api.js";
  import type { Project } from "./types.js";

  interface Props {
    availableRepos: string[];
    onClose: () => void;
    onChanged?: () => void;
  }

  let { availableRepos, onClose, onChanged }: Props = $props();

  let projects = $state<Project[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  let showCreate = $state(false);
  let newSlug = $state("");
  let newName = $state("");
  let newColor = $state("#7c3aed");
  let newRepoIds = $state<string[]>([]);
  let creating = $state(false);

  async function load() {
    loading = true;
    try {
      projects = await fetchProjects();
      error = null;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }

  async function handleCreate(event: SubmitEvent) {
    event.preventDefault();
    creating = true;
    try {
      await createProject({
        slug: newSlug.trim(),
        name: newName.trim(),
        color: newColor,
        repo_ids: newRepoIds,
      });
      newSlug = "";
      newName = "";
      newRepoIds = [];
      showCreate = false;
      await load();
      onChanged?.();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      creating = false;
    }
  }

  async function handleArchive(project: Project) {
    try {
      await updateProject(project.id, { archived: !project.archived });
      await load();
      onChanged?.();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  async function handleDelete(project: Project) {
    if (!confirm(`Supprimer le projet "${project.name}" ? Les tickets seront détachés.`)) return;
    try {
      await deleteProject(project.id);
      await load();
      onChanged?.();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  function toggleRepo(repoId: string) {
    if (newRepoIds.includes(repoId)) {
      newRepoIds = newRepoIds.filter((id) => id !== repoId);
    } else {
      newRepoIds = [...newRepoIds, repoId];
    }
  }

  load();
</script>

<div class="backdrop" onclick={onClose} role="presentation">
  <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
    <header>
      <h2>Projets</h2>
      <button class="close" onclick={onClose}>✕</button>
    </header>

    {#if error}
      <div class="error">{error}</div>
    {/if}

    {#if loading}
      <div class="loading">chargement…</div>
    {:else}
      <ul class="projects">
        {#each projects as project (project.id)}
          <li class:archived={project.archived}>
            <span class="dot" style:background={project.color ?? "#98a2b3"}></span>
            <div class="info">
              <strong>{project.name}</strong>
              <span class="slug">{project.slug}</span>
              {#if project.repo_ids.length > 0}
                <span class="repos">{project.repo_ids.join(", ")}</span>
              {/if}
            </div>
            <div class="actions">
              <button onclick={() => handleArchive(project)}>{project.archived ? "désarchiver" : "archiver"}</button>
              <button class="danger" onclick={() => handleDelete(project)}>supprimer</button>
            </div>
          </li>
        {/each}
      </ul>

      {#if showCreate}
        <form class="create" onsubmit={handleCreate}>
          <div class="row">
            <label>Slug<input bind:value={newSlug} placeholder="twoody" pattern="[a-z0-9][a-z0-9-]*" required /></label>
            <label>Nom<input bind:value={newName} placeholder="Twoody" required /></label>
            <label class="color">Couleur<input type="color" bind:value={newColor} /></label>
          </div>
          {#if availableRepos.length > 0}
            <div class="repos-grid">
              <span>Repos :</span>
              {#each availableRepos as repo (repo)}
                <label class="repo-chip">
                  <input
                    type="checkbox"
                    checked={newRepoIds.includes(repo)}
                    onchange={() => toggleRepo(repo)}
                  />
                  {repo}
                </label>
              {/each}
            </div>
          {/if}
          <div class="form-actions">
            <button type="button" onclick={() => (showCreate = false)}>annuler</button>
            <button class="primary" type="submit" disabled={creating}>{creating ? "création…" : "créer"}</button>
          </div>
        </form>
      {:else}
        <button class="add" onclick={() => (showCreate = true)}>+ nouveau projet</button>
      {/if}
    {/if}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(16, 24, 40, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }
  .modal {
    background: white;
    border-radius: 8px;
    box-shadow: 0 20px 24px rgba(16, 24, 40, 0.18);
    max-width: 520px;
    width: 92%;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  header {
    padding: 16px 20px;
    border-bottom: 1px solid #e4e7ec;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  h2 {
    margin: 0;
    font-size: 16px;
  }
  .close {
    background: transparent;
    border: none;
    font-size: 18px;
    cursor: pointer;
    color: #475467;
  }
  .error {
    background: #fef0c7;
    color: #b54708;
    padding: 8px 20px;
    font-size: 12px;
  }
  .loading {
    padding: 32px;
    text-align: center;
    color: #667085;
  }
  .projects {
    list-style: none;
    margin: 0;
    padding: 8px 0;
    overflow-y: auto;
    flex: 1;
  }
  .projects li {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 20px;
    border-bottom: 1px solid #f0f0f0;
  }
  .projects li.archived { opacity: 0.5; }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .slug {
    font-size: 11px;
    color: #667085;
    font-family: ui-monospace, monospace;
  }
  .repos {
    font-size: 11px;
    color: #475467;
  }
  .actions {
    display: flex;
    gap: 4px;
  }
  button {
    background: #f2f4f7;
    border: 1px solid #d0d5dd;
    border-radius: 4px;
    padding: 4px 8px;
    cursor: pointer;
    font-size: 12px;
  }
  button.danger { color: #b42318; }
  button.add {
    margin: 12px 20px;
    align-self: flex-start;
  }
  .create {
    padding: 16px 20px;
    background: #f9fafb;
    border-top: 1px solid #e4e7ec;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .row {
    display: grid;
    grid-template-columns: 1fr 1fr 64px;
    gap: 8px;
  }
  .row label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 11px;
    color: #475467;
  }
  .row input {
    padding: 6px 8px;
    border: 1px solid #d0d5dd;
    border-radius: 4px;
    font-size: 13px;
  }
  .color input {
    height: 30px;
    padding: 2px;
  }
  .repos-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
    font-size: 12px;
    color: #475467;
  }
  .repo-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 6px;
    background: white;
    border: 1px solid #d0d5dd;
    border-radius: 3px;
    cursor: pointer;
  }
  .form-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  button.primary {
    background: #1570ef;
    color: white;
    border-color: #1570ef;
  }
  button.primary:hover { background: #155eef; }
</style>
