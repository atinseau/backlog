<script lang="ts">
  // Console-area panel — Xcode debug-area style. Tabbed: Activity feed
  // (agent runs, tool calls, file edits) and Chat (orchestrator chat).
  // Both children are kept mounted so SSE subscriptions stay alive when
  // the user switches tabs.
  import ActivityBanner from "../ActivityBanner.svelte";
  import OrchestratorChat from "../OrchestratorChat.svelte";
  import { t } from "../i18n.svelte.js";

  export type BottomTab = "activity" | "chat";

  interface Props {
    workspaceId: string | null;
    tab: BottomTab;
    onSelectTab: (tab: BottomTab) => void;
    onOpenDiff?: (runId: string, file: string) => void;
  }

  let { workspaceId, tab, onSelectTab, onOpenDiff }: Props = $props();
</script>

<section class="bottom-panel" aria-label="Console">
  <div class="tabs" role="tablist">
    <button
      class="tab"
      class:active={tab === "activity"}
      onclick={() => onSelectTab("activity")}
      role="tab"
      aria-selected={tab === "activity"}
    >
      {t("bottom.activity")}
    </button>
    <button
      class="tab"
      class:active={tab === "chat"}
      onclick={() => onSelectTab("chat")}
      role="tab"
      aria-selected={tab === "chat"}
    >
      {t("bottom.chat")}
    </button>
  </div>

  <div class="content">
    <div class="pane" hidden={tab !== "activity"}>
      <ActivityBanner workspaceId={workspaceId} onOpenDiff={onOpenDiff} embedded={true} />
    </div>
    <div class="pane" hidden={tab !== "chat"}>
      <OrchestratorChat
        open={true}
        workspaceId={workspaceId}
        onClose={() => {}}
        embedded={true}
      />
    </div>
  </div>
</section>

<style>
  .bottom-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg-surface);
    color: var(--text-primary);
    overflow: hidden;
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
    /* Keep mounted (so SSE subs survive) but visually + a11y hidden. */
    display: none;
  }
  .pane :global(.drawer.embedded),
  .pane :global(.panel.embedded) {
    flex: 1 1 auto;
    min-height: 0;
  }
</style>
