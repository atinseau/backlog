<script lang="ts">
  // Navigator pane — Xcode-style. Workspace + repo at the top, then a
  // vertical list of sections that swap the center content (or open a
  // modal view, until those views get inlined). Profile + locale at
  // the bottom mirror Xcode's status indicators on the navigator base.
  import LocaleToggle from "../LocaleToggle.svelte";
  import ProjectSelector from "../ProjectSelector.svelte";
  import RepoSelector from "../RepoSelector.svelte";
  import ThemeToggle from "../ThemeToggle.svelte";
  import { t } from "../i18n.svelte.js";
  import type { CloudStatus } from "../api.js";
  import type { ProjectEntry, Repo } from "../types.js";

  export type SectionKey =
    | "board"
    | "activity"
    | "commits"
    | "agents"
    | "integrations"
    | "permissions"
    | "repos"
    | "settings";

  interface Props {
    workspaces: ProjectEntry[];
    selectedWorkspaceId: string | null;
    onSelectWorkspace: (id: string) => void;
    onCreateProject: () => void;
    repos: Repo[];
    selectedRepoId: string | null;
    onSelectRepo: (id: string | null) => void;
    onManageRepos: () => void;
    section: SectionKey;
    onSelectSection: (key: SectionKey) => void;
    cloudStatus: CloudStatus | null;
    onOpenProfile: () => void;
  }

  let {
    workspaces,
    selectedWorkspaceId,
    onSelectWorkspace,
    onCreateProject,
    repos,
    selectedRepoId,
    onSelectRepo,
    onManageRepos,
    section,
    onSelectSection,
    cloudStatus,
    onOpenProfile,
  }: Props = $props();

  const SECTIONS: { key: SectionKey; label: () => string; icon: string }[] = [
    { key: "board", label: () => t("nav.board"), icon: "▦" },
    { key: "activity", label: () => t("topbar.activity"), icon: "⏱" },
    { key: "commits", label: () => t("nav.commits"), icon: "⎇" },
    { key: "agents", label: () => t("nav.agents"), icon: "🤖" },
    { key: "integrations", label: () => t("nav.integrations"), icon: "🔌" },
    { key: "permissions", label: () => t("nav.permissions"), icon: "🔒" },
    { key: "repos", label: () => t("nav.repos"), icon: "📦" },
    { key: "settings", label: () => t("nav.settings"), icon: "⚙" },
  ];

  function userInitials(email: string): string {
    const local = email.split("@")[0] ?? "";
    return local.slice(0, 2).toUpperCase() || "?";
  }
</script>

<aside class="left-panel">
  <div class="selectors">
    {#if workspaces.length > 0 && selectedWorkspaceId}
      <div class="row">
        <ProjectSelector
          projects={workspaces}
          selectedId={selectedWorkspaceId}
          onSelect={onSelectWorkspace}
        />
        <button class="add" onclick={onCreateProject} title={t("selector.new_project")}>+</button>
      </div>
    {/if}
    <RepoSelector
      repos={repos}
      selectedId={selectedRepoId}
      projectScoped={false}
      onSelect={onSelectRepo}
      onManage={onManageRepos}
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
      </button>
    {/each}
  </nav>

  <div class="footer">
    <button
      class="avatar"
      class:signed-in={cloudStatus?.signed_in}
      onclick={onOpenProfile}
      title={cloudStatus?.user?.email ?? t("topbar.profile_signed_out")}
      aria-label={t("topbar.profile")}
    >
      {#if cloudStatus?.signed_in && cloudStatus.user}
        {userInitials(cloudStatus.user.email)}
      {:else}
        ☺
      {/if}
    </button>
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
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .row :global(.project-selector),
  .selectors :global(.repo-selector) {
    flex: 1;
    min-width: 0;
  }
  .add {
    flex: 0 0 auto;
    background: transparent;
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    padding: 2px 8px;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 14px;
    line-height: 1.2;
  }
  .add:hover {
    color: var(--accent);
    border-color: var(--accent);
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
  .section.active .icon {
    color: var(--accent);
  }
  .footer {
    border-top: 1px solid var(--border-subtle);
    padding: 6px 10px;
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--bg-muted);
  }
  .avatar {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    border: 1px solid var(--border-strong);
    background: var(--bg-hover);
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 11px;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .avatar.signed-in {
    background: var(--success-bg);
    color: var(--success);
    border-color: var(--success);
  }
</style>
