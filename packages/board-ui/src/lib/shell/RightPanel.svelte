<script lang="ts">
  // Inspector pane — Xcode-style. Shows details for the currently
  // selected task (using the existing TaskDetailDialog component in
  // embedded mode so we don't fork the data-loading code). Empty state
  // when nothing is selected, mirroring Xcode's "No Selection" panel.
  import TaskDetailDialog from "../TaskDetailDialog.svelte";
  import { t } from "../i18n.svelte.js";

  interface Props {
    selectedTaskId: string | null;
    onClearSelection: () => void;
    onSplit?: () => void;
    onAddSubTask?: () => void;
  }

  let { selectedTaskId, onClearSelection, onSplit, onAddSubTask }: Props = $props();
</script>

<aside class="right-panel" aria-label="Inspector">
  {#if selectedTaskId}
    <TaskDetailDialog
      taskId={selectedTaskId}
      onClose={onClearSelection}
      onSplit={onSplit}
      onAddSubTask={onAddSubTask}
      embedded={true}
    />
  {:else}
    <div class="empty">
      <p class="title">{t("inspector.empty_title")}</p>
      <p class="hint">{t("inspector.empty_hint")}</p>
    </div>
  {/if}
</aside>

<style>
  .right-panel {
    height: 100%;
    width: 100%;
    background: white;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 24px;
    text-align: center;
    color: #667085;
  }
  .title {
    margin: 0 0 4px;
    font-size: 13px;
    font-weight: 500;
    color: #344054;
  }
  .hint {
    margin: 0;
    font-size: 12px;
  }
</style>
