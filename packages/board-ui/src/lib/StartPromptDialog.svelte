<script lang="ts">
  import { startOrchestrator } from "./api.js";

  interface Props {
    taskId: string;
    subTasksCreated: number;
    onClose: () => void;
    onStarted?: () => void;
  }

  let { taskId, subTasksCreated, onClose, onStarted }: Props = $props();

  let busy = $state(false);
  let error = $state<string | null>(null);

  async function startNow() {
    busy = true;
    error = null;
    try {
      await startOrchestrator({});
      onStarted?.();
      onClose();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }
</script>

<div class="backdrop" onclick={onClose} role="presentation">
  <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
    <header>
      <h2>Démarrer maintenant ?</h2>
    </header>
    <div class="body">
      <p>
        Tâche <code>{taskId}</code> créée
        {#if subTasksCreated > 0}
          avec <strong>{subTasksCreated}</strong> sous-tâche{subTasksCreated > 1 ? "s" : ""} prête{subTasksCreated > 1 ? "s" : ""}.
        {:else}
          (sans sous-tâche pour l'instant).
        {/if}
      </p>
      {#if subTasksCreated > 0}
        <p class="muted">L'orchestrateur va lancer les sous-tâches assignables sur leurs agents.</p>
      {:else}
        <p class="muted">Sans sous-tâche, l'orchestrateur n'a rien à exécuter — vous pouvez quand même le démarrer mais il restera en attente.</p>
      {/if}
      {#if error}
        <div class="error">{error}</div>
      {/if}
    </div>
    <footer>
      <button type="button" onclick={onClose} disabled={busy}>Plus tard</button>
      <button type="button" class="primary" onclick={startNow} disabled={busy}>
        {busy ? "Démarrage…" : "Démarrer ▶"}
      </button>
    </footer>
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
    z-index: 110;
  }
  .modal {
    background: white;
    border-radius: 8px;
    box-shadow: 0 20px 24px rgba(16, 24, 40, 0.18);
    max-width: 460px;
    width: 92%;
  }
  header { padding: 16px 20px; border-bottom: 1px solid #e4e7ec; }
  h2 { margin: 0; font-size: 16px; }
  .body { padding: 16px 20px; display: flex; flex-direction: column; gap: 8px; }
  p { margin: 0; line-height: 1.5; }
  code {
    background: #f2f4f7;
    padding: 1px 6px;
    border-radius: 3px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
  }
  .muted { color: #98a2b3; font-size: 12px; }
  .error {
    background: #fee4e2;
    color: #b42318;
    border-radius: 4px;
    padding: 8px 10px;
    font-size: 12px;
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
    padding: 6px 14px;
    cursor: pointer;
    font-size: 13px;
  }
  button.primary {
    background: #027a48;
    color: white;
    border-color: #027a48;
    font-weight: 500;
  }
  button.primary:hover:not(:disabled) { background: #036a3e; }
  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
