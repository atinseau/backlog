<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import ClaimsView from "./lib/ClaimsView.svelte";
  import Column from "./lib/Column.svelte";
  import CommitsView from "./lib/CommitsView.svelte";
  import CreateSubTaskDialog from "./lib/CreateSubTaskDialog.svelte";
  import CreateTaskDialog from "./lib/CreateTaskDialog.svelte";
  import IntegrationsView from "./lib/IntegrationsView.svelte";
  import ActivityBanner from "./lib/ActivityBanner.svelte";
  import OrchestratorChat from "./lib/OrchestratorChat.svelte";
  import OrchestratorControls from "./lib/OrchestratorControls.svelte";
  import OrchestratorPanel from "./lib/OrchestratorPanel.svelte";
  import PermissionsView from "./lib/PermissionsView.svelte";
  import RepoSelector from "./lib/RepoSelector.svelte";
  import ReposView from "./lib/ReposView.svelte";
  import LocaleToggle from "./lib/LocaleToggle.svelte";
  import SplitDialog from "./lib/SplitDialog.svelte";
  import StartPromptDialog from "./lib/StartPromptDialog.svelte";
  import TaskDetailDialog from "./lib/TaskDetailDialog.svelte";
  import CreateProjectDialog from "./lib/CreateProjectDialog.svelte";
  import OnboardingBanner from "./lib/OnboardingBanner.svelte";
  import ProjectSelector from "./lib/ProjectSelector.svelte";
  import { t } from "./lib/i18n.svelte.js";
  import {
    fetchBoard,
    fetchCloudStatus,
    fetchCurrentProject,
    fetchRepos,
    fetchProjectsList,
    approveRun,
    moveWorkItem,
    reorderTask,
    setCurrentProjectId,
    startRun,
    type CloudStatus,
  } from "./lib/api.js";
  import { subscribeToBoard, type BoardSseClient } from "./lib/sse.js";
  import { formatDuration } from "./lib/timer.svelte.js";
  import {
    COLUMN_ORDER,
    type BoardResponse,
    type ColumnKey,
    type Repo,
    type TaskCard,
    type ProjectEntry,
  } from "./lib/types.js";

  const REPO_STORAGE_KEY = "backlog.selected_repo_id";
  const WORKSPACE_STORAGE_KEY = "backlog.selected_project_id";

  let board = $state<BoardResponse | null>(null);
  let workspaceRepos = $state<Repo[]>([]);
  let workspaces = $state<ProjectEntry[]>([]);
  let selectedWorkspaceId = $state<string | null>(null);
  let selectedRepoId = $state<string | null>(null);
  let error = $state<string | null>(null);
  let lastUpdated = $state<string | null>(null);
  let inFlightMove = $state<string | null>(null);
  let connected = $state(false);
  let claimsViewOpen = $state(false);
  let commitsViewOpen = $state(false);
  let integrationsOpen = $state(false);
  let reposViewOpen = $state(false);
  let createProjectOpen = $state(false);
  const ONBOARDING_STORAGE_KEY = "backlog.onboarding.dismissed";
  let onboardingDismissed = $state(
    typeof localStorage !== "undefined" && localStorage.getItem(ONBOARDING_STORAGE_KEY) === "1",
  );

  function dismissOnboarding() {
    onboardingDismissed = true;
    localStorage.setItem(ONBOARDING_STORAGE_KEY, "1");
  }
  let cloudStatus = $state<CloudStatus | null>(null);
  let integrationsTab = $state<"account" | "github" | "jira" | "sources">("account");

  async function loadCloudStatus() {
    try {
      cloudStatus = await fetchCloudStatus();
    } catch {
      cloudStatus = { signed_in: false };
    }
  }

  function userInitials(email: string): string {
    const local = email.split("@")[0] ?? "";
    return local.slice(0, 2).toUpperCase() || "?";
  }

  function openProfile() {
    integrationsTab = "account";
    integrationsOpen = true;
  }
  let permissionsViewOpen = $state(false);
  let createTaskOpen = $state(false);
  let createSubTaskTarget = $state<TaskCard | null>(null);
  let panelOpen = $state(false);
  // Persist the chat drawer's open/closed state across reloads — most users
  // either want it always-on (operations dashboard mode) or always-off
  // (focused execution mode), so toggling it once should stick.
  const CHAT_STORAGE_KEY = "backlog.chat.open";
  let chatOpen = $state(typeof localStorage !== "undefined" && localStorage.getItem(CHAT_STORAGE_KEY) === "1");
  function toggleChat() {
    chatOpen = !chatOpen;
    if (typeof localStorage !== "undefined") {
      if (chatOpen) localStorage.setItem(CHAT_STORAGE_KEY, "1");
      else localStorage.removeItem(CHAT_STORAGE_KEY);
    }
  }
  let splitTarget = $state<TaskCard | null>(null);
  let detailTarget = $state<TaskCard | null>(null);
  let startPrompt = $state<{ taskId: string; subTasksCreated: number } | null>(null);
  let pollFallback: ReturnType<typeof setInterval> | null = null;
  let sse: BoardSseClient | null = null;
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;

  // Repos visible in the kanban — the "fallback" set when the workspace has no
  // configured repos yet (we surface whatever the cards reference).
  const boardRepoIds = $derived.by(() => {
    if (!board) return [] as string[];
    const set = new Set<string>();
    for (const column of Object.values(board.columns)) {
      for (const card of column) {
        for (const repo of card.repo_targets) set.add(repo);
        for (const task of card.tasks) set.add(task.repo);
      }
    }
    return [...set].sort();
  });

  // Repo dropdown source — workspace repos when known, otherwise reverse-engineered
  // from the board cards.
  const repoOptions = $derived.by<Repo[]>(() => {
    if (workspaceRepos.length > 0) return workspaceRepos;
    return boardRepoIds.map((id) => ({ id, path: id, default_branch: "main", enabled: true }));
  });

  // The string-only `repos` prop fed to the modals/dialogs that just need a list of repo ids.
  const repos = $derived(repoOptions.map((r) => r.id));

  async function refresh() {
    try {
      const opts: { repo?: string } = {};
      if (selectedRepoId) opts.repo = selectedRepoId;
      board = await fetchBoard(opts);
      error = null;
      lastUpdated = new Date().toLocaleTimeString("fr-FR");
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  async function refreshRepos() {
    try {
      workspaceRepos = await fetchRepos();
    } catch (err) {
      console.warn("repo fetch failed", err);
    }
  }

  async function refreshWorkspaces() {
    try {
      workspaces = await fetchProjectsList();
    } catch (err) {
      console.warn("workspaces fetch failed", err);
    }
  }

  function scheduleRefresh() {
    if (refreshTimer) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      refresh();
    }, 150);
  }

  function persistRepo(id: string | null) {
    selectedRepoId = id;
    if (id) localStorage.setItem(REPO_STORAGE_KEY, id);
    else localStorage.removeItem(REPO_STORAGE_KEY);
    refresh();
  }

  function teardownSse() {
    sse?.close();
    sse = null;
    if (pollFallback) {
      clearInterval(pollFallback);
      pollFallback = null;
    }
    connected = false;
  }

  function connectSse() {
    teardownSse();
    sse = subscribeToBoard(
      (type) => {
        if (type === "ping" || type === "ready") return;
        scheduleRefresh();
        if (type === "repo.changed") refreshRepos();
      },
      (alive) => {
        connected = alive;
        if (!alive && !pollFallback) {
          pollFallback = setInterval(refresh, 5000);
        } else if (alive && pollFallback) {
          clearInterval(pollFallback);
          pollFallback = null;
        }
      },
    );
  }

  function applyWorkspace(id: string) {
    if (id === selectedWorkspaceId) return;
    selectedWorkspaceId = id;
    setCurrentProjectId(id);
    localStorage.setItem(WORKSPACE_STORAGE_KEY, id);
    // Reset per-workspace selection — repo ids belong to the previous
    // workspace and almost certainly don't match the new one.
    selectedRepoId = null;
    localStorage.removeItem(REPO_STORAGE_KEY);
    board = null;
    workspaceRepos = [];
    refresh();
    refreshRepos();
    connectSse();
  }

  async function bootstrap() {
    await refreshWorkspaces();
    let preferred = localStorage.getItem(WORKSPACE_STORAGE_KEY);
    const known = new Set(workspaces.map((w) => w.id));
    if (preferred && !known.has(preferred)) {
      // The remembered workspace was unregistered — fall back to current.
      localStorage.removeItem(WORKSPACE_STORAGE_KEY);
      preferred = null;
    }
    if (!preferred) {
      try {
        const current = await fetchCurrentProject();
        // /workspaces/current returns paths; match against the registry to find the id.
        const match = workspaces.find((w) => w.path === current.root);
        preferred = match?.id ?? workspaces[0]?.id ?? null;
      } catch {
        preferred = workspaces[0]?.id ?? null;
      }
    }
    if (preferred) {
      selectedWorkspaceId = preferred;
      setCurrentProjectId(preferred);
    }
    selectedRepoId = localStorage.getItem(REPO_STORAGE_KEY);
    refresh();
    refreshRepos();
    connectSse();
    loadCloudStatus();
  }

  async function handleMove(workItemId: string, toStatus: string, _toColumn: ColumnKey) {
    if (!board) return;
    inFlightMove = workItemId;
    try {
      await moveWorkItem(workItemId, toStatus);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      inFlightMove = null;
      if (!connected) await refresh();
    }
  }

  async function handleReorder(workItemId: string, beforeId: string | null, afterId: string | null) {
    try {
      const input: { before_id?: string; after_id?: string } = {};
      if (beforeId) input.before_id = beforeId;
      if (afterId) input.after_id = afterId;
      await reorderTask(workItemId, input);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      if (!connected) await refresh();
    }
  }

  async function handleApproveCard(_card: TaskCard, runId: string) {
    error = null;
    try {
      await approveRun(runId);
    } catch (err) {
      error = t("card.approve_failed", {
        reason: err instanceof Error ? err.message : String(err),
      });
    } finally {
      if (!connected) await refresh();
    }
  }

  async function handlePlayCard(card: TaskCard) {
    error = null;
    try {
      const result = await startRun({ task_id: card.id, approve: true });
      if (result.started.length === 0) {
        // Server accepted the request (200/202) but nothing actually
        // launched — usually because every subtask is blocked or
        // waiting. Surface the reason so the user isn't left wondering.
        const reason =
          result.skipped[0]?.reasons[0] ??
          result.blocked[0]?.reasons[0] ??
          result.waiting[0]?.reasons[0];
        error = reason
          ? t("card.play_skipped", { reason })
          : t("card.play_skipped_empty");
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      if (!connected) await refresh();
    }
  }

  onMount(() => {
    bootstrap();
  });

  onDestroy(() => {
    teardownSse();
    if (refreshTimer) clearTimeout(refreshTimer);
  });
</script>

<header class="topbar">
  <div class="topbar-left">
    <h1>Backlog</h1>
    {#if workspaces.length > 0 && selectedWorkspaceId}
      <ProjectSelector
        projects={workspaces}
        selectedId={selectedWorkspaceId}
        onSelect={applyWorkspace}
      />
    {/if}
    <button class="topbar-add-project" onclick={() => (createProjectOpen = true)} title={t("selector.new_project")}>
      +
    </button>
    <RepoSelector
      repos={repoOptions}
      selectedId={selectedRepoId}
      projectScoped={false}
      onSelect={persistRepo}
      onManage={() => (reposViewOpen = true)}
    />
    <OrchestratorControls
      onError={(message) => (error = message)}
    />
  </div>
  <div class="meta">
    {#if board}
      {#if board.total_remaining_seconds > 0}
        <span class="eta-pill">{t("topbar.remaining", { duration: formatDuration(board.total_remaining_seconds) })}</span>
        <span class="dot">·</span>
      {/if}
      <span>{t("topbar.runs", { count: board.active_runs_count })}</span>
      <span class="dot">·</span>
      <span class:on={connected} class:off={!connected} class="conn">
        {connected ? t("topbar.live") : t("topbar.polling")}
      </span>
      {#if lastUpdated}
        <span class="dot">·</span>
        <span>{t("topbar.last_update", { time: lastUpdated })}</span>
      {/if}
      {#if inFlightMove}
        <span class="dot">·</span>
        <span class="moving">{t("topbar.moving")}</span>
      {/if}
    {/if}
    <LocaleToggle />
    <button onclick={() => (claimsViewOpen = true)} title={t("topbar.activity")}>📋 {t("topbar.activity")}</button>
    <button onclick={() => (commitsViewOpen = true)} title={t("topbar.commits")}>{t("topbar.commits")}</button>
    <button onclick={() => (integrationsOpen = true)} title={t("topbar.integrations")}>{t("topbar.integrations")}</button>
    <button onclick={() => (permissionsViewOpen = true)}>{t("topbar.permissions")}</button>
    <button onclick={toggleChat} class:active={chatOpen} title={t("chat.title")}>{t("topbar.chat")}</button>
    <button onclick={() => (panelOpen = !panelOpen)}>{t("topbar.plan")}</button>
    <button class="primary" onclick={() => (createTaskOpen = true)}>{t("topbar.new_task")}</button>
    <button onclick={refresh} aria-label={t("topbar.refresh")}>{t("topbar.refresh")}</button>
    <button
      class="user-avatar"
      class:signed-in={cloudStatus?.signed_in}
      onclick={openProfile}
      title={cloudStatus?.user?.email ?? t("topbar.profile_signed_out")}
      aria-label={t("topbar.profile")}
    >
      {#if cloudStatus?.signed_in && cloudStatus.user}
        {userInitials(cloudStatus.user.email)}
      {:else}
        ☺
      {/if}
    </button>
  </div>
</header>

{#if error}
  <div class="error">{error}</div>
{/if}

<OnboardingBanner
  workspaces={workspaces}
  workspaceRepos={workspaceRepos}
  board={board}
  dismissed={onboardingDismissed}
  onCreateProject={() => (createProjectOpen = true)}
  onManageRepos={() => (reposViewOpen = true)}
  onCreateTask={() => (createTaskOpen = true)}
  onDismiss={dismissOnboarding}
/>

<main class="board">
  {#each COLUMN_ORDER as key (key)}
    <Column
      columnKey={key}
      cards={board?.columns[key] ?? []}
      onMove={handleMove}
      onReorder={handleReorder}
      onSplit={(card) => (splitTarget = card)}
      onAddTask={(card) => (createSubTaskTarget = card)}
      onOpen={(card) => (detailTarget = card)}
      onPlay={handlePlayCard}
      onApprove={handleApproveCard}
    />
  {/each}
</main>

{#if createProjectOpen}
  <CreateProjectDialog
    onClose={() => (createProjectOpen = false)}
    onCreated={(project, openRepos) => {
      createProjectOpen = false;
      refreshWorkspaces().then(() => {
        applyWorkspace(project.id);
        if (openRepos) reposViewOpen = true;
      });
    }}
  />
{/if}

{#if reposViewOpen}
  <ReposView
    onClose={() => (reposViewOpen = false)}
    onChanged={() => {
      refreshRepos();
      if (!connected) refresh();
    }}
  />
{/if}

{#if claimsViewOpen}
  <ClaimsView
    onClose={() => (claimsViewOpen = false)}
    onChanged={() => {
      if (!connected) refresh();
    }}
  />
{/if}

{#if commitsViewOpen}
  <CommitsView onClose={() => (commitsViewOpen = false)} />
{/if}

{#if integrationsOpen}
  <IntegrationsView
    defaultTab={integrationsTab}
    onClose={() => {
      integrationsOpen = false;
      loadCloudStatus();
    }}
    onChanged={() => {
      refreshRepos();
      if (!connected) refresh();
      loadCloudStatus();
    }}
  />
{/if}

{#if permissionsViewOpen}
  <PermissionsView
    availableRepos={repos}
    onClose={() => (permissionsViewOpen = false)}
    onChanged={() => {
      if (!connected) refresh();
    }}
  />
{/if}

{#if createTaskOpen}
  <CreateTaskDialog
    availableRepos={repos}
    onClose={() => (createTaskOpen = false)}
    onCreated={(result) => {
      if (!connected) refresh();
      startPrompt = result;
    }}
  />
{/if}

{#if startPrompt}
  <StartPromptDialog
    taskId={startPrompt.taskId}
    subTasksCreated={startPrompt.subTasksCreated}
    onClose={() => (startPrompt = null)}
    onStarted={() => {
      if (!connected) refresh();
    }}
  />
{/if}

{#if createSubTaskTarget}
  <CreateSubTaskDialog
    workItem={createSubTaskTarget}
    availableRepos={repos}
    onClose={() => (createSubTaskTarget = null)}
    onCreated={() => {
      if (!connected) refresh();
    }}
  />
{/if}

{#if panelOpen}
  <OrchestratorPanel
    onClose={() => (panelOpen = false)}
  />
{/if}

<OrchestratorChat open={chatOpen} workspaceId={selectedWorkspaceId} onClose={toggleChat} />
<ActivityBanner workspaceId={selectedWorkspaceId} />

{#if splitTarget}
  <SplitDialog
    workItem={splitTarget}
    availableRepos={repos}
    onClose={() => (splitTarget = null)}
    onSplit={() => {
      if (!connected) refresh();
    }}
  />
{/if}

{#if detailTarget}
  <TaskDetailDialog
    taskId={detailTarget.id}
    onClose={() => (detailTarget = null)}
    onSplit={() => {
      splitTarget = detailTarget;
      detailTarget = null;
    }}
    onAddSubTask={() => {
      createSubTaskTarget = detailTarget;
      detailTarget = null;
    }}
  />
{/if}

<style>
  :global(body) {
    margin: 0;
    background: #f7f8fa;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    color: #1d2939;
  }
  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 24px;
    background: white;
    border-bottom: 1px solid #e4e7ec;
    position: sticky;
    top: 0;
    z-index: 10;
  }
  .topbar-left {
    display: flex;
    align-items: center;
    gap: 16px;
  }
  h1 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
  }
  .meta {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: #667085;
  }
  .dot { opacity: 0.5; }
  .moving { color: #1570ef; }
  .conn.on { color: #027a48; }
  .conn.off { color: #b54708; }
  .eta-pill {
    background: #eff8ff;
    color: #175cd3;
    padding: 2px 8px;
    border-radius: 10px;
    font-weight: 500;
  }
  button {
    background: #f2f4f7;
    border: 1px solid #d0d5dd;
    border-radius: 4px;
    padding: 4px 10px;
    cursor: pointer;
    font-size: 14px;
  }
  button:hover { background: #e4e7ec; }
  button.active {
    background: #d1fadf;
    border-color: #027a48;
    color: #027a48;
  }
  button.active:hover { background: #c5f4d3; }
  button.primary {
    background: #1570ef;
    color: white;
    border-color: #1570ef;
  }
  button.topbar-add-project {
    padding: 2px 10px;
    font-size: 16px;
    line-height: 1;
    color: #475467;
  }
  button.topbar-add-project:hover { color: #1570ef; }
  button.user-avatar {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    padding: 0;
    margin-left: 4px;
    font-size: 12px;
    font-weight: 600;
    background: #f2f4f7;
    color: #475467;
    border: 1px solid #d0d5dd;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  button.user-avatar.signed-in {
    background: #d1fadf;
    color: #027a48;
    border-color: #b6efbe;
  }
  button.user-avatar:hover { box-shadow: 0 0 0 3px rgba(21, 112, 239, 0.15); }
  button.primary:hover { background: #155eef; }
  .error {
    background: #fef0c7;
    color: #b54708;
    padding: 8px 24px;
    font-size: 13px;
  }
  .board {
    display: grid;
    grid-template-columns: repeat(4, minmax(240px, 1fr));
    gap: 12px;
    padding: 16px;
    /* 26px is the always-visible ActivityBanner toggle bar at the
       bottom — pad so nothing gets hidden behind it. */
    padding-bottom: calc(16px + 26px);
    align-items: start;
    min-height: calc(100vh - 60px);
  }
</style>
