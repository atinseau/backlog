<script lang="ts">
  import DialogShell from "./DialogShell.svelte";
  import { t } from "./i18n.svelte.js";

  interface Props {
    taskTitle: string;
    onClose: () => void;
    onRetryDirect: () => Promise<void> | void;
    onRunInWorktree: () => Promise<void> | void;
  }

  let { taskTitle, onClose, onRetryDirect, onRunInWorktree }: Props = $props();

  let busy = $state<"direct" | "worktree" | null>(null);
  let localError = $state<string | null>(null);

  async function run(kind: "direct" | "worktree", action: () => Promise<void> | void) {
    busy = kind;
    localError = null;
    try {
      await action();
    } catch (err) {
      localError = err instanceof Error ? err.message : String(err);
    } finally {
      busy = null;
    }
  }
</script>

<DialogShell onClose={() => { if (!busy) onClose(); }} ariaLabel={t("direct_dirty.title")} extraClass="direct-dirty-dialog">
  <header>
    <h2>{t("direct_dirty.title")}</h2>
  </header>
  <div class="body">
    <p>{t("direct_dirty.body")}</p>
    <p class="task">{t("direct_dirty.task", { title: taskTitle })}</p>
    <div class="choices">
      <div>
        <strong>{t("direct_dirty.worktree_label")}</strong>
        <span>{t("direct_dirty.worktree_hint")}</span>
      </div>
      <div>
        <strong>{t("direct_dirty.retry_label")}</strong>
        <span>{t("direct_dirty.retry_hint")}</span>
      </div>
    </div>
    {#if localError}
      <div class="error">{localError}</div>
    {/if}
  </div>
  <footer>
    <button type="button" onclick={onClose} disabled={busy !== null}>{t("direct_dirty.cancel")}</button>
    <button
      type="button"
      onclick={() => run("direct", onRetryDirect)}
      disabled={busy !== null}
    >{busy === "direct" ? t("direct_dirty.retrying") : t("direct_dirty.retry")}</button>
    <button
      type="button"
      class="primary"
      onclick={() => run("worktree", onRunInWorktree)}
      disabled={busy !== null}
    >{busy === "worktree" ? t("direct_dirty.starting_worktree") : t("direct_dirty.start_worktree")}</button>
  </footer>
</DialogShell>

<style>
  :global(.direct-dirty-dialog) {
    max-width: 520px;
  }
  header {
    padding: 16px 20px;
    border-bottom: 1px solid var(--border-default);
  }
  h2 {
    margin: 0;
    font-size: 16px;
  }
  .body {
    padding: 16px 20px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  p {
    margin: 0;
    line-height: 1.45;
  }
  .task {
    color: var(--text-subtle);
    font-size: 12px;
  }
  .choices {
    display: grid;
    gap: 8px;
  }
  .choices > div {
    border: 1px solid var(--border-default);
    border-radius: 6px;
    padding: 10px 12px;
    background: var(--bg-muted);
    display: grid;
    gap: 3px;
  }
  strong {
    font-size: 13px;
  }
  span {
    color: var(--text-subtle);
    font-size: 12px;
    line-height: 1.4;
  }
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
    flex-wrap: wrap;
  }
  button {
    background: var(--bg-hover);
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    padding: 6px 12px;
    cursor: pointer;
    font-size: 13px;
  }
  button.primary {
    background: var(--success);
    color: white;
    border-color: var(--success);
    font-weight: 600;
  }
  button.primary:hover:not(:disabled) {
    background: #036a3e;
  }
  button:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
</style>
