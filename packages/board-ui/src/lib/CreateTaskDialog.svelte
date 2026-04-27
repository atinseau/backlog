<script lang="ts">
  import { createSubTask } from "./api.js";
  import type { TaskCard } from "./types.js";

  interface Props {
    workItem: TaskCard;
    availableRepos: string[];
    onClose: () => void;
    onCreated?: () => void;
  }

  let { workItem, availableRepos, onClose, onCreated }: Props = $props();

  let title = $state("");
  let repo = $state(workItem.repo_targets[0] ?? availableRepos[0] ?? "");
  let scopes = $state("");
  let lane = $state("");
  let risk = $state<"low" | "medium" | "high">("medium");
  let submitting = $state(false);
  let error = $state<string | null>(null);

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    submitting = true;
    error = null;
    try {
      const input: Parameters<typeof createSubTask>[0] = {
        work_item_id: workItem.id,
        title: title.trim(),
        repo,
        risk,
      };
      const trimmedScopes = scopes
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      if (trimmedScopes.length > 0) input.scopes = trimmedScopes;
      if (lane.trim()) input.lane = lane.trim();
      await createSubTask(input);
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
      <h2>Nouvelle tâche</h2>
      <span class="ticket">{workItem.title}</span>
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

      <div class="row">
        <label>
          Repo
          <select bind:value={repo} required>
            {#each availableRepos as r (r)}
              <option value={r}>{r}</option>
            {/each}
          </select>
        </label>
        <label>
          Lane (optionnel)
          <input type="text" bind:value={lane} placeholder="frontend" />
        </label>
        <label>
          Risque
          <select bind:value={risk}>
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
          </select>
        </label>
      </div>

      <label>
        Scopes (un par ligne, ex. <code>src/foo/**</code>)
        <textarea bind:value={scopes} rows="3" placeholder="src/feature/**"></textarea>
      </label>
    </div>

    <footer>
      <button type="button" onclick={onClose}>annuler</button>
      <button type="submit" class="primary" disabled={submitting || !title.trim() || !repo}>
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
    align-items: baseline;
    gap: 8px;
  }
  h2 { margin: 0; font-size: 16px; flex-shrink: 0; }
  .ticket {
    flex: 1;
    color: #667085;
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
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
  code { font-family: ui-monospace, monospace; font-size: 11px; }
  input, select, textarea {
    padding: 6px 8px;
    border: 1px solid #d0d5dd;
    border-radius: 4px;
    font-size: 13px;
    font-family: inherit;
  }
  textarea { resize: vertical; font-family: ui-monospace, monospace; }
  .row {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 8px;
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
