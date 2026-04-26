<script lang="ts">
  import { createWorkItem } from "./api.js";
  import type { Project } from "./types.js";

  interface Props {
    projects: Project[];
    availableRepos: string[];
    selectedProjectId: string | null;
    onClose: () => void;
    onCreated?: () => void;
  }

  let { projects, availableRepos, selectedProjectId, onClose, onCreated }: Props = $props();

  let title = $state("");
  let description = $state("");
  let priority = $state<"P0" | "P1" | "P2" | "P3">("P2");
  let projectId = $state(selectedProjectId ?? "");
  let repoTargets = $state<string[]>([]);
  let estimatedMinutes = $state<number | null>(null);
  let submitting = $state(false);
  let error = $state<string | null>(null);

  function toggleRepo(id: string) {
    repoTargets = repoTargets.includes(id) ? repoTargets.filter((r) => r !== id) : [...repoTargets, id];
  }

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    submitting = true;
    error = null;
    try {
      const input: Parameters<typeof createWorkItem>[0] = {
        title: title.trim(),
        priority,
      };
      if (description.trim()) input.description = description.trim();
      if (projectId) input.project_id = projectId;
      if (repoTargets.length > 0) input.repo_targets = repoTargets;
      if (estimatedMinutes && estimatedMinutes > 0) input.estimated_duration_seconds = Math.round(estimatedMinutes * 60);
      await createWorkItem(input);
      onCreated?.();
      onClose();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      submitting = false;
    }
  }
</script>

<div class="backdrop" onclick={onClose} role="presentation">
  <form class="modal" onclick={(e) => e.stopPropagation()} onsubmit={handleSubmit}>
    <header>
      <h2>Nouveau ticket</h2>
      <button type="button" class="close" onclick={onClose}>✕</button>
    </header>

    {#if error}
      <div class="error">{error}</div>
    {/if}

    <div class="body">
      <label>
        Titre
        <input type="text" bind:value={title} required autofocus />
      </label>

      <label>
        Description
        <textarea bind:value={description} rows="3"></textarea>
      </label>

      <div class="row">
        <label>
          Priorité
          <select bind:value={priority}>
            <option value="P0">P0 — bloquant</option>
            <option value="P1">P1 — haut</option>
            <option value="P2">P2 — normal</option>
            <option value="P3">P3 — bas</option>
          </select>
        </label>
        <label>
          Projet
          <select bind:value={projectId}>
            <option value="">— sans projet —</option>
            {#each projects.filter((p) => !p.archived) as project (project.id)}
              <option value={project.id}>{project.name}</option>
            {/each}
          </select>
        </label>
        <label>
          Estimation (min)
          <input type="number" min="1" bind:value={estimatedMinutes} placeholder="auto" />
        </label>
      </div>

      {#if availableRepos.length > 0}
        <div class="repos">
          <span class="label">Repos cibles :</span>
          {#each availableRepos as repo (repo)}
            <label class="chip">
              <input type="checkbox" checked={repoTargets.includes(repo)} onchange={() => toggleRepo(repo)} />
              {repo}
            </label>
          {/each}
        </div>
      {/if}
    </div>

    <footer>
      <button type="button" onclick={onClose}>annuler</button>
      <button type="submit" class="primary" disabled={submitting || !title.trim()}>
        {submitting ? "création…" : "créer"}
      </button>
    </footer>
  </form>
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
    display: flex;
    flex-direction: column;
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
  .body {
    padding: 16px 20px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    color: #475467;
  }
  input, select, textarea {
    padding: 6px 8px;
    border: 1px solid #d0d5dd;
    border-radius: 4px;
    font-size: 13px;
    font-family: inherit;
  }
  textarea { resize: vertical; }
  .row {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 8px;
  }
  .repos {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
    font-size: 12px;
    color: #475467;
  }
  .repos .label { margin-right: 4px; }
  .chip {
    flex-direction: row !important;
    align-items: center;
    gap: 4px;
    padding: 2px 6px;
    background: #f2f4f7;
    border: 1px solid #d0d5dd;
    border-radius: 3px;
    cursor: pointer;
  }
  footer {
    padding: 12px 20px;
    border-top: 1px solid #e4e7ec;
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  button {
    background: #f2f4f7;
    border: 1px solid #d0d5dd;
    border-radius: 4px;
    padding: 6px 12px;
    cursor: pointer;
    font-size: 13px;
  }
  button.primary {
    background: #1570ef;
    color: white;
    border-color: #1570ef;
  }
  button.primary:disabled {
    background: #98a2b3;
    border-color: #98a2b3;
    cursor: not-allowed;
  }
</style>
