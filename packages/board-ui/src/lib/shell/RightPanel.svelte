<script lang="ts">
  // Inspector pane — Xcode-style with two tabs at the top:
  //   • Inspector: details for the currently selected task
  //   • Chat: orchestrator conversation
  // Both children stay mounted across tab switches so SSE subscriptions
  // and the chat history don't drop when the user flips between them.
  import OrchestratorChat from "../OrchestratorChat.svelte";
  import TaskDetailDialog from "../TaskDetailDialog.svelte";
  import { t } from "../i18n.svelte.js";

  export type RightTab = "inspector" | "chat";

  interface Props {
    selectedTaskId: string | null;
    onClearSelection: () => void;
    onSplit?: () => void;
    onAddSubTask?: () => void;
    workspaceId: string | null;
    tab: RightTab;
    onSelectTab: (tab: RightTab) => void;
  }

  let {
    selectedTaskId,
    onClearSelection,
    onSplit,
    onAddSubTask,
    workspaceId,
    tab,
    onSelectTab,
  }: Props = $props();
</script>

<aside class="right-panel" aria-label="Inspector">
  <div class="tabs" role="tablist">
    <button
      class="tab"
      class:active={tab === "inspector"}
      onclick={() => onSelectTab("inspector")}
      role="tab"
      aria-selected={tab === "inspector"}
    >
      {t("right.inspector")}
    </button>
    <button
      class="tab"
      class:active={tab === "chat"}
      onclick={() => onSelectTab("chat")}
      role="tab"
      aria-selected={tab === "chat"}
    >
      {t("right.chat")}
    </button>
  </div>

  <div class="content">
    <div class="pane" hidden={tab !== "inspector"}>
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
    </div>
    <div class="pane" hidden={tab !== "chat"}>
      <OrchestratorChat open={true} workspaceId={workspaceId} onClose={() => {}} embedded={true} />
    </div>
  </div>
</aside>

<style>
  .right-panel {
    height: 100%;
    width: 100%;
    background: var(--bg-surface);
    color: var(--text-primary);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .tabs {
    display: flex;
    align-items: stretch;
    border-bottom: 1px solid var(--border-default);
    background: var(--bg-muted);
    flex-shrink: 0;
    padding: 0 8px;
  }
  .tab {
    background: transparent;
    border: none;
    padding: 6px 14px;
    cursor: pointer;
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 500;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
  }
  .tab:hover {
    color: var(--text-body);
  }
  .tab.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }
  .content {
    flex: 1 1 auto;
    min-height: 0;
    position: relative;
  }
  .pane {
    position: absolute;
    inset: 0;
    display: flex;
    overflow: hidden;
  }
  .pane[hidden] {
    /* Keep mounted (so SSE + chat history persist) but visually + a11y hidden. */
    display: none;
  }
  .pane :global(.drawer.embedded),
  .pane :global(.inspector) {
    flex: 1 1 auto;
    min-height: 0;
  }
  .empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 24px;
    text-align: center;
    color: var(--text-muted);
  }
  .title {
    margin: 0 0 4px;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-body);
  }
  .hint {
    margin: 0;
    font-size: 12px;
  }
</style>
