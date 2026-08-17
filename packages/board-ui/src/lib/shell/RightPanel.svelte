<script lang="ts">
  // Right pane — dedicated to the orchestrator chat now. The task
  // inspector moved to the center column so it can use the full width
  // when reviewing a card.
  import GitDiffPanel from "../GitDiffPanel.svelte";
  import OrchestratorChat from "../OrchestratorChat.svelte";
  import { t } from "../i18n.svelte.js";

  interface Props {
    projectId: string | null;
    gitDiffTarget?: { repo: string; file: string; sha?: string | null; base?: string | null; head?: string | null; refreshKey?: number } | null;
    onCloseGitDiff?: () => void;
  }

  let { projectId, gitDiffTarget = null, onCloseGitDiff }: Props = $props();
</script>

<aside class="right-panel" aria-label={gitDiffTarget ? t("shell.git_diff") : t("shell.chat")}>
  {#if gitDiffTarget}
    <GitDiffPanel
      repo={gitDiffTarget.repo}
      file={gitDiffTarget.file}
      sha={gitDiffTarget.sha}
      base={gitDiffTarget.base}
      head={gitDiffTarget.head}
      refreshKey={gitDiffTarget.refreshKey}
      onClose={onCloseGitDiff}
    />
  {:else}
    <OrchestratorChat open={true} projectId={projectId} onClose={() => {}} embedded={true} />
  {/if}
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
