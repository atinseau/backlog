<script lang="ts">
  import DialogShell from "./DialogShell.svelte";
  import { startOrchestrator } from "./api.js";
  import { t } from "./i18n.svelte.js";

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

<DialogShell {onClose} ariaLabel={t("start_prompt.title")}>
  <header>
    <h2>{t("start_prompt.title")}</h2>
  </header>
  <div class="body">
    {#if subTasksCreated === 0}
      <p>{@html t("start_prompt.body.no_subtasks", { taskId: `<code>${taskId}</code>` })}</p>
      <p class="muted">{t("start_prompt.help.empty")}</p>
    {:else if subTasksCreated === 1}
      <p>{@html t("start_prompt.body.with_subtasks_one", { taskId: `<code>${taskId}</code>`, count: subTasksCreated })}</p>
      <p class="muted">{t("start_prompt.help.ready")}</p>
    {:else}
      <p>{@html t("start_prompt.body.with_subtasks_many", { taskId: `<code>${taskId}</code>`, count: subTasksCreated })}</p>
      <p class="muted">{t("start_prompt.help.ready")}</p>
    {/if}
    {#if error}
      <div class="error">{error}</div>
    {/if}
  </div>
  <footer>
    <button type="button" onclick={onClose} disabled={busy}>{t("start_prompt.button.later")}</button>
    <button type="button" class="primary" onclick={startNow} disabled={busy}>
      {busy ? t("start_prompt.button.starting") : t("start_prompt.button.start")}
    </button>
  </footer>
</DialogShell>

<style>
  /* Frame (.modal, .backdrop) lives in DialogShell. Styles below
     scope to the elements this component renders into the slot. */
  header { padding: 16px 20px; border-bottom: 1px solid var(--border-default); }
  h2 { margin: 0; font-size: 16px; }
  .body { padding: 16px 20px; display: flex; flex-direction: column; gap: 8px; }
  p { margin: 0; line-height: 1.5; }
  .muted { color: var(--text-subtle); font-size: 12px; }
  .error {
    background: var(--danger-bg);
    color: var(--danger);
    border-radius: 4px;
    padding: 8px 10px;
    font-size: 12px;
  }
  footer {
    padding: 12px 20px;
    border-top: 1px solid var(--border-default);
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  button {
    background: var(--bg-hover);
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    padding: 6px 14px;
    cursor: pointer;
    font-size: 13px;
  }
  button.primary {
    background: var(--success);
    color: white;
    border-color: var(--success);
    font-weight: 500;
  }
  button.primary:hover:not(:disabled) { background: #036a3e; }
  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
