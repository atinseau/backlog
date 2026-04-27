<script lang="ts">
  import { t } from "./i18n.svelte.js";
  import { createRepo, deleteRepo, fetchRepos, updateRepo } from "./api.js";
  import type { Repo } from "./types.js";

  interface Props {
    onClose: () => void;
    onChanged?: () => void;
  }

  let { onClose, onChanged }: Props = $props();

  let repos = $state<Repo[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  let showCreate = $state(false);
  let createMode = $state<"local" | "clone">("local");
  let newId = $state("");
  let newPath = $state("");
  let newGitUrl = $state("");
  let newCloneInto = $state("");
  let newBranch = $state("main");
  let newRole = $state("");
  let creating = $state(false);

  async function load() {
    loading = true;
    try {
      repos = await fetchRepos();
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
      const input: Parameters<typeof createRepo>[0] = {};
      if (newId.trim()) input.id = newId.trim();
      if (newRole.trim()) input.role = newRole.trim();
      if (newBranch.trim()) input.default_branch = newBranch.trim();

      if (createMode === "clone") {
        if (!newGitUrl.trim()) throw new Error("URL Git requise");
        input.git_url = newGitUrl.trim();
        if (newCloneInto.trim()) input.clone_into = newCloneInto.trim();
      } else {
        if (!newPath.trim()) throw new Error("Chemin local requis");
        if (!newId.trim()) throw new Error("Id requis");
        if (!newBranch.trim()) throw new Error("Branche par défaut requise");
        input.path = newPath.trim();
      }

      await createRepo(input);
      newId = "";
      newPath = "";
      newGitUrl = "";
      newCloneInto = "";
      newBranch = "main";
      newRole = "";
      showCreate = false;
      await load();
      onChanged?.();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      creating = false;
    }
  }

  async function handleToggleEnabled(repo: Repo) {
    try {
      await updateRepo(repo.id, { enabled: !repo.enabled });
      await load();
      onChanged?.();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  async function handleDelete(repo: Repo) {
    const force = confirm(
      `Supprimer le repo "${repo.id}" ?\n\nOK = supprimer (avec --force pour cascader sur tasks/work-items/agents)\nAnnuler = abandonner.`,
    );
    if (!force) return;
    try {
      await deleteRepo(repo.id, { force: true });
      await load();
      onChanged?.();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  async function handleRename(repo: Repo) {
    const next = prompt(`Renommer le repo ${repo.id} →`, repo.id);
    if (!next || next === repo.id) return;
    try {
      await updateRepo(repo.id, { id: next });
      await load();
      onChanged?.();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  load();
</script>

<div class="backdrop" onclick={onClose} role="presentation">
  <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
    <header>
      <h2>{t("repos_view.title")}</h2>
      <button class="close" onclick={onClose}>✕</button>
    </header>

    {#if error}
      <div class="error">{error}</div>
    {/if}

    {#if loading}
      <div class="loading">chargement…</div>
    {:else}
      <ul class="repos">
        {#each repos as repo (repo.id)}
          <li class:disabled={!repo.enabled}>
            <div class="info">
              <div class="title-row">
                <strong>{repo.id}</strong>
                {#if repo.role}<span class="role">{repo.role}</span>{/if}
                {#if !repo.enabled}<span class="off">disabled</span>{/if}
              </div>
              <span class="path">{repo.path}</span>
              <span class="branch">branche par défaut : {repo.default_branch}</span>
            </div>
            <div class="actions">
              <button onclick={() => handleRename(repo)} title="Renommer">✎</button>
              <button onclick={() => handleToggleEnabled(repo)}>
                {repo.enabled ? "désactiver" : "activer"}
              </button>
              <button class="danger" onclick={() => handleDelete(repo)}>supprimer</button>
            </div>
          </li>
        {/each}
        {#if repos.length === 0}
          <li class="empty">aucun repo configuré</li>
        {/if}
      </ul>

      {#if showCreate}
        <form class="create" onsubmit={handleCreate}>
          <div class="tabs">
            <button
              type="button"
              class="tab"
              class:active={createMode === "local"}
              onclick={() => (createMode = "local")}
            >
              📁 Local
            </button>
            <button
              type="button"
              class="tab"
              class:active={createMode === "clone"}
              onclick={() => (createMode = "clone")}
            >
              ⬇ Cloner Git
            </button>
          </div>

          {#if createMode === "clone"}
            <label class="full">
              URL Git
              <input
                bind:value={newGitUrl}
                placeholder="https://github.com/user/repo.git"
                required
              />
            </label>
            <div class="row">
              <label>Id <span class="hint">(auto si vide)</span><input bind:value={newId} placeholder="repo" pattern="[a-zA-Z0-9_-]*" /></label>
              <label>Branche<input bind:value={newBranch} placeholder="main" /></label>
            </div>
            <label class="full">
              Cloner dans <span class="hint">(défaut : workspace/repos/&lt;id&gt;)</span>
              <input bind:value={newCloneInto} placeholder="repos/frontend" />
            </label>
          {:else}
            <div class="row">
              <label>Id<input bind:value={newId} placeholder="frontend" required pattern="[a-zA-Z0-9_-]+" /></label>
              <label>Branche par défaut<input bind:value={newBranch} placeholder="main" /></label>
            </div>
            <label class="full">
              Chemin (absolu ou relatif au workspace)
              <input bind:value={newPath} placeholder="/Users/jimmy/Dev/twoody/twoody-frontend" required />
            </label>
          {/if}

          <label class="full">
            Rôle (optionnel)
            <input bind:value={newRole} placeholder="api / web / firmware" />
          </label>
          <div class="form-actions">
            <button type="button" onclick={() => (showCreate = false)}>annuler</button>
            <button class="primary" type="submit" disabled={creating}>
              {creating ? (createMode === "clone" ? "clonage…" : "ajout…") : (createMode === "clone" ? "cloner" : "ajouter")}
            </button>
          </div>
        </form>
      {:else}
        <button class="add" onclick={() => (showCreate = true)}>+ ajouter un repo</button>
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
    max-width: 580px;
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
  h2 { margin: 0; font-size: 16px; }
  .close { background: transparent; border: none; font-size: 18px; cursor: pointer; color: #475467; }
  .error { background: #fef0c7; color: #b54708; padding: 8px 20px; font-size: 12px; }
  .loading {
    padding: 32px;
    text-align: center;
    color: #667085;
  }
  .repos {
    list-style: none;
    margin: 0;
    padding: 8px 0;
    overflow-y: auto;
    flex: 1;
  }
  .repos li {
    display: flex;
    gap: 12px;
    padding: 10px 20px;
    border-bottom: 1px solid #f0f0f0;
    align-items: flex-start;
  }
  .repos li.disabled { opacity: 0.5; }
  .repos li.empty {
    padding: 24px 20px;
    text-align: center;
    color: #98a2b3;
    border: none;
  }
  .info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .title-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
  }
  .role {
    font-size: 11px;
    background: #eff8ff;
    color: #175cd3;
    padding: 1px 6px;
    border-radius: 3px;
  }
  .off {
    font-size: 11px;
    background: #fee4e2;
    color: #b42318;
    padding: 1px 6px;
    border-radius: 3px;
  }
  .path {
    font-family: ui-monospace, monospace;
    font-size: 11px;
    color: #475467;
    word-break: break-all;
  }
  .branch {
    font-size: 11px;
    color: #667085;
  }
  .actions {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
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
  .tabs {
    display: flex;
    gap: 4px;
    margin-bottom: 4px;
  }
  .tab {
    flex: 1;
    background: white;
    border: 1px solid #d0d5dd;
    border-radius: 4px;
    padding: 6px 10px;
    cursor: pointer;
    font-size: 13px;
    color: #475467;
  }
  .tab.active {
    background: #1570ef;
    color: white;
    border-color: #1570ef;
  }
  .hint {
    color: #98a2b3;
    font-weight: 400;
  }
  .row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .create label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 11px;
    color: #475467;
  }
  .create label.full { grid-column: 1 / -1; }
  .create input {
    padding: 6px 8px;
    border: 1px solid #d0d5dd;
    border-radius: 4px;
    font-size: 13px;
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
