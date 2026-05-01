<script lang="ts">
  // Console-area panel — Xcode debug-area style. Now Activity-only:
  // the orchestrator chat moved to the right panel as a tab next to
  // the inspector, so this surface stays focused on the live event
  // feed (agent runs, tool calls, file edits).
  import ActivityBanner from "../ActivityBanner.svelte";
  import { t } from "../i18n.svelte.js";

  // Type retained for callsites that persist the active tab; today
  // there is only one tab but keeping the type keeps the storage key
  // backward-compatible and the door open for future expansion.
  export type BottomTab = "activity";

  interface Props {
    projectId: string | null;
    onOpenDiff?: (runId: string, file: string) => void;
  }

  let { projectId, onOpenDiff }: Props = $props();
</script>

<section class="bottom-panel" aria-label="Console">
  <div class="tabs" role="tablist">
    <button class="tab active" role="tab" aria-selected="true">{t("bottom.activity")}</button>
  </div>
  <div class="content">
    <ActivityBanner projectId={projectId} onOpenDiff={onOpenDiff} embedded={true} />
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
    cursor: default;
    color: var(--accent);
    font-size: 12px;
    font-weight: 500;
    border-bottom: 2px solid var(--accent);
    margin-bottom: -1px;
  }
  .content {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    overflow: hidden;
  }
  .content :global(.panel.embedded) {
    flex: 1 1 auto;
    min-height: 0;
  }
</style>
