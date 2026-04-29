<script lang="ts">
  // Right pane — dedicated to the orchestrator chat now. The task
  // inspector moved to the center column so it can use the full width
  // when reviewing a card.
  import OrchestratorChat from "../OrchestratorChat.svelte";

  interface Props {
    workspaceId: string | null;
  }

  let { workspaceId }: Props = $props();
</script>

<aside class="right-panel" aria-label="Chat">
  <OrchestratorChat open={true} workspaceId={workspaceId} onClose={() => {}} embedded={true} />
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
  .right-panel :global(.drawer.embedded) {
    flex: 1 1 auto;
    min-height: 0;
  }
</style>
