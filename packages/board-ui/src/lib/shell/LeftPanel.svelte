<script lang="ts">
  // Navigator pane — Xcode-style. Project + repository at the top, then a
  // vertical list of sections that swap the center content (or open a
  // modal view, until those views get inlined). Profile + locale at
  // the bottom mirror Xcode's status indicators on the navigator base.
  import LocaleToggle from "../LocaleToggle.svelte";
  import RepositorySelector from "../RepositorySelector.svelte";
  import ThemeToggle from "../ThemeToggle.svelte";
  import { t } from "../i18n.svelte.js";
  import type { GitStatusSummary, Repository } from "../types.js";

  export type SectionKey =
    | "board"
    | "backlog"
    | "claims"
    | "activity"
    | "commits"
    | "agents"
    | "users"
    | "integrations"
    | "instructions"
    | "hooks"
    | "repos"
    | "settings";

  interface Props {
    repos: Repository[];
    repoGitStatuses?: Record<string, GitStatusSummary>;
    backlogCount?: number;
    activeClaimsCount?: number;
    selectedRepoId: string | null;
    onSelectRepo: (id: string | null) => void;
    onManageRepos: () => void;
    onCreateRepo?: () => void;
    section: SectionKey;
    onSelectSection: (key: SectionKey) => void;
  }

  let {
    repos,
    repoGitStatuses = {},
    backlogCount = 0,
    activeClaimsCount = 0,
    selectedRepoId,
    onSelectRepo,
    onManageRepos,
    onCreateRepo,
    section,
    onSelectSection,
  }: Props = $props();

  const SECTIONS: { key: SectionKey; label: () => string; icon: string }[] = [
    { key: "board", label: () => t("nav.board"), icon: "▦" },
    { key: "backlog", label: () => t("nav.backlog"), icon: "☰" },
    { key: "claims", label: () => t("nav.claims"), icon: "⌖" },
    { key: "activity", label: () => t("nav.runs"), icon: "⏱" },
    { key: "commits", label: () => t("nav.git"), icon: "⎇" },
    { key: "agents", label: () => t("nav.agents"), icon: "🤖" },
    { key: "instructions", label: () => t("nav.instructions"), icon: "▤" },
    { key: "hooks", label: () => t("nav.hooks"), icon: "⌁" },
    { key: "repos", label: () => t("nav.repos"), icon: "📦" },
    { key: "settings", label: () => t("nav.settings"), icon: "⚙" },
  ];

  const gitDirtyCount = $derived.by(() => {
    if (selectedRepoId) return repoGitStatuses[selectedRepoId]?.total ?? 0;
    return repos.reduce((sum, repo) => sum + (repoGitStatuses[repo.id]?.total ?? 0), 0);
  });

</script>

<aside class="left-panel">
  <div class="selectors">
    <RepositorySelector
      repos={repos}
      gitStatuses={repoGitStatuses}
      selectedId={selectedRepoId}
      projectScoped={false}
      onSelect={onSelectRepo}
      onManage={onManageRepos}
      onCreate={onCreateRepo}
    />
  </div>

  <nav class="sections" aria-label="Navigator">
    {#each SECTIONS as item (item.key)}
      <button
        class="section"
        class:active={section === item.key}
        onclick={() => onSelectSection(item.key)}
      >
        <span class="icon">{item.icon}</span>
        <span class="label">{item.label()}</span>
        {#if item.key === "commits" && gitDirtyCount > 0}
          <span class="nav-badge" title={t("git_status.changed_total", { count: gitDirtyCount })}>
            {gitDirtyCount}
          </span>
        {:else if item.key === "backlog" && backlogCount > 0}
          <span class="nav-badge" title={t("backlog_view.count", { count: backlogCount })}>
            {backlogCount}
          </span>
        {:else if item.key === "claims" && activeClaimsCount > 0}
          <span class="nav-badge" title={t("nav.claims_active", { count: activeClaimsCount })}>
            {activeClaimsCount}
          </span>
        {/if}
      </button>
    {/each}
  </nav>

  <div class="footer">
    <LocaleToggle />
    <ThemeToggle />
  </div>
</aside>

<style>
  .left-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg-muted);
    overflow: hidden;
    font-size: 13px;
    color: var(--text-body);
  }
  .selectors {
    padding: 10px 10px 8px;
    border-bottom: 1px solid var(--border-subtle);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .selectors :global(.repository-selector) {
    flex: 1;
    min-width: 0;
  }
  .sections {
    flex: 1 1 auto;
    overflow-y: auto;
    padding: 6px 6px;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .section {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--text-body);
    cursor: pointer;
    text-align: left;
    font-size: 13px;
  }
  .section:hover {
    background: var(--bg-active);
  }
  .section.active {
    background: var(--accent-bg);
    color: var(--accent-text);
    font-weight: 500;
  }
  .section .icon {
    width: 18px;
    text-align: center;
    color: var(--text-muted);
  }
  .section .label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .section.active .icon {
    color: var(--accent);
  }
  .nav-badge {
    margin-left: auto;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--warning-bg);
    color: var(--warning);
    border: 1px solid color-mix(in srgb, var(--warning) 34%, transparent);
    font-size: 11px;
    font-weight: 700;
    line-height: 1;
  }
  .footer {
    border-top: 1px solid var(--border-subtle);
    padding: 6px 10px;
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--bg-muted);
  }
</style>
