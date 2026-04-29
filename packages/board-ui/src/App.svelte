<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import ClaimsView from "./lib/ClaimsView.svelte";
  import Column from "./lib/Column.svelte";
  import CommitsView from "./lib/CommitsView.svelte";
  import CreateSubTaskDialog from "./lib/CreateSubTaskDialog.svelte";
  import CreateTaskDialog from "./lib/CreateTaskDialog.svelte";
  import IntegrationsView from "./lib/IntegrationsView.svelte";
  import AgentsView from "./lib/AgentsView.svelte";
  import DiffPanel from "./lib/DiffPanel.svelte";
  import OrchestratorControls from "./lib/OrchestratorControls.svelte";
  import PermissionsView from "./lib/PermissionsView.svelte";
  import ReposView from "./lib/ReposView.svelte";
  import SplitDialog from "./lib/SplitDialog.svelte";
  import StartPromptDialog from "./lib/StartPromptDialog.svelte";
  import CreateProjectDialog from "./lib/CreateProjectDialog.svelte";
  import OnboardingBanner from "./lib/OnboardingBanner.svelte";
  import LeftPanel, { type SectionKey } from "./lib/shell/LeftPanel.svelte";
  import RightPanel from "./lib/shell/RightPanel.svelte";
  import BottomPanel, { type BottomTab } from "./lib/shell/BottomPanel.svelte";
  import PanelToggles from "./lib/shell/PanelToggles.svelte";
  import Splitter from "./lib/shell/Splitter.svelte";
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
  // Shell layout persistence — open/closed flags + pixel sizes for the
  // three panels, plus the active section in the navigator and the
  // active tab in the bottom console. Together these fully describe
  // the user's chosen layout, restored on next launch.
  const SHELL_LEFT_OPEN = "backlog.shell.left.open";
  const SHELL_RIGHT_OPEN = "backlog.shell.right.open";
  const SHELL_BOTTOM_OPEN = "backlog.shell.bottom.open";
  const SHELL_LEFT_WIDTH = "backlog.shell.left.width";
  const SHELL_RIGHT_WIDTH = "backlog.shell.right.width";
  const SHELL_BOTTOM_HEIGHT = "backlog.shell.bottom.height";
  const SHELL_BOTTOM_TAB = "backlog.shell.bottom.tab";

  function readBool(key: string, fallback: boolean): boolean {
    if (typeof localStorage === "undefined") return fallback;
    const raw = localStorage.getItem(key);
    if (raw === "1") return true;
    if (raw === "0") return false;
    return fallback;
  }
  function writeBool(key: string, value: boolean): void {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(key, value ? "1" : "0");
  }
  function readNum(key: string, fallback: number, min: number, max: number): number {
    if (typeof localStorage === "undefined") return fallback;
    const raw = localStorage.getItem(key);
    const n = raw ? Number.parseFloat(raw) : NaN;
    if (Number.isFinite(n)) return Math.max(min, Math.min(max, n));
    return fallback;
  }
  function writeNum(key: string, value: number): void {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(key, String(Math.round(value)));
  }

  // ---- board / data state ----
  let board = $state<BoardResponse | null>(null);
  let workspaceRepos = $state<Repo[]>([]);
  let workspaces = $state<ProjectEntry[]>([]);
  let selectedWorkspaceId = $state<string | null>(null);
  let selectedRepoId = $state<string | null>(null);
  let error = $state<string | null>(null);
  let lastUpdated = $state<string | null>(null);
  let inFlightMove = $state<string | null>(null);
  let connected = $state(false);
  let cloudStatus = $state<CloudStatus | null>(null);

  // ---- modal / dialog state ----
  // Section views (Activity / Commits / Agents / Integrations / Permissions
  // / Repos) used to be modals; they're now rendered inline in the center
  // when their section is active. The remaining modal state below is for
  // genuinely-modal flows (create / split / start prompt / project create).
  let createProjectOpen = $state(false);
  let createTaskOpen = $state(false);
  let createSubTaskTarget = $state<TaskCard | null>(null);
  let splitTarget = $state<TaskCard | null>(null);
  let startPrompt = $state<{ taskId: string; subTasksCreated: number } | null>(null);
  let integrationsTab = $state<"account" | "github" | "jira" | "sources">("account");

  // ---- shell layout state ----
  let leftOpen = $state(readBool(SHELL_LEFT_OPEN, true));
  let rightOpen = $state(readBool(SHELL_RIGHT_OPEN, false));
  let bottomOpen = $state(readBool(SHELL_BOTTOM_OPEN, false));
  let leftWidth = $state(readNum(SHELL_LEFT_WIDTH, 240, 180, 480));
  let rightWidth = $state(readNum(SHELL_RIGHT_WIDTH, 320, 220, 560));
  let bottomHeight = $state(readNum(SHELL_BOTTOM_HEIGHT, 240, 120, 600));
  let leftSection = $state<SectionKey>("board");
  let bottomTab = $state<BottomTab>(
    (typeof localStorage !== "undefined"
      ? (localStorage.getItem(SHELL_BOTTOM_TAB) as BottomTab | null)
      : null) ?? "activity",
  );
  let selectedTaskId = $state<string | null>(null);
  let diffTarget = $state<{ runId: string; file: string } | null>(null);

  // ---- onboarding ----
  const ONBOARDING_STORAGE_KEY = "backlog.onboarding.dismissed";
  let onboardingDismissed = $state(
    typeof localStorage !== "undefined" && localStorage.getItem(ONBOARDING_STORAGE_KEY) === "1",
  );
  function dismissOnboarding() {
    onboardingDismissed = true;
    localStorage.setItem(ONBOARDING_STORAGE_KEY, "1");
  }

  // ---- runtime infra ----
  let pollFallback: ReturnType<typeof setInterval> | null = null;
  let sse: BoardSseClient | null = null;
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;

  async function loadCloudStatus() {
    try {
      cloudStatus = await fetchCloudStatus();
    } catch {
      cloudStatus = { signed_in: false };
    }
  }

  function openProfile() {
    integrationsTab = "account";
    leftSection = "integrations";
  }

  // Repos visible in the kanban — the "fallback" set when the workspace
  // has no configured repos yet (we surface whatever the cards reference).
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
  const repoOptions = $derived.by<Repo[]>(() => {
    if (workspaceRepos.length > 0) return workspaceRepos;
    return boardRepoIds.map((id) => ({ id, path: id, default_branch: "main", enabled: true }));
  });
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
    selectedRepoId = null;
    localStorage.removeItem(REPO_STORAGE_KEY);
    board = null;
    workspaceRepos = [];
    selectedTaskId = null;
    refresh();
    refreshRepos();
    connectSse();
  }

  async function bootstrap() {
    await refreshWorkspaces();
    let preferred = localStorage.getItem(WORKSPACE_STORAGE_KEY);
    const known = new Set(workspaces.map((w) => w.id));
    if (preferred && !known.has(preferred)) {
      localStorage.removeItem(WORKSPACE_STORAGE_KEY);
      preferred = null;
    }
    if (!preferred) {
      try {
        const current = await fetchCurrentProject();
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
        const reason =
          result.skipped[0]?.reasons[0] ??
          result.blocked[0]?.reasons[0] ??
          result.waiting[0]?.reasons[0];
        if (reason) {
          error = t("card.play_skipped", { reason });
        } else if (card.tasks.length === 0) {
          error = t("card.play_no_subtasks");
        } else {
          error = t("card.play_skipped_empty");
        }
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      if (!connected) await refresh();
    }
  }

  // ---- shell behaviours ----
  function toggleLeft() {
    leftOpen = !leftOpen;
    writeBool(SHELL_LEFT_OPEN, leftOpen);
  }
  function toggleRight() {
    rightOpen = !rightOpen;
    writeBool(SHELL_RIGHT_OPEN, rightOpen);
  }
  function toggleBottom() {
    bottomOpen = !bottomOpen;
    writeBool(SHELL_BOTTOM_OPEN, bottomOpen);
  }
  function setBottomTab(tab: BottomTab) {
    bottomTab = tab;
    if (typeof localStorage !== "undefined") localStorage.setItem(SHELL_BOTTOM_TAB, tab);
    if (!bottomOpen) toggleBottom();
  }
  function commitLeftWidth() { writeNum(SHELL_LEFT_WIDTH, leftWidth); }
  function commitRightWidth() { writeNum(SHELL_RIGHT_WIDTH, rightWidth); }
  function commitBottomHeight() { writeNum(SHELL_BOTTOM_HEIGHT, bottomHeight); }

  function applySection(key: SectionKey) {
    leftSection = key;
  }

  function selectCard(card: TaskCard) {
    selectedTaskId = card.id;
    if (!rightOpen) toggleRight();
  }

  // The right-panel split/add-subtask actions need the full TaskCard
  // (not just an id), so look it up from the current board snapshot.
  function findCardById(id: string): TaskCard | null {
    if (!board) return null;
    for (const column of Object.values(board.columns)) {
      const found = column.find((c) => c.id === id);
      if (found) return found;
    }
    return null;
  }

  onMount(() => {
    bootstrap();
  });
  onDestroy(() => {
    teardownSse();
    if (refreshTimer) clearTimeout(refreshTimer);
  });
</script>

<div class="shell" style:--left-w="{leftWidth}px" style:--right-w="{rightWidth}px" style:--bottom-h="{bottomHeight}px">
  <header class="topbar">
    <div class="topbar-left">
      <h1>Backlog</h1>
      <OrchestratorControls onError={(message) => (error = message)} />
    </div>
    <div class="topbar-right">
      {#if board}
        {#if board.total_remaining_seconds > 0}
          <span class="eta-pill">{t("topbar.remaining", { duration: formatDuration(board.total_remaining_seconds) })}</span>
        {/if}
        <span class:on={connected} class:off={!connected} class="conn">
          {connected ? t("topbar.live") : t("topbar.polling")}
        </span>
      {/if}
      <button class="primary" onclick={() => (createTaskOpen = true)}>{t("topbar.new_task")}</button>
      <PanelToggles
        leftOpen={leftOpen}
        bottomOpen={bottomOpen}
        rightOpen={rightOpen}
        onToggleLeft={toggleLeft}
        onToggleBottom={toggleBottom}
        onToggleRight={toggleRight}
      />
    </div>
  </header>

  {#if error}
    <div class="error">{error}</div>
  {/if}

  <div class="grid">
    {#if leftOpen}
      <div class="left-host">
        <LeftPanel
          workspaces={workspaces}
          selectedWorkspaceId={selectedWorkspaceId}
          onSelectWorkspace={applyWorkspace}
          onCreateProject={() => (createProjectOpen = true)}
          repos={repoOptions}
          selectedRepoId={selectedRepoId}
          onSelectRepo={persistRepo}
          onManageRepos={() => (reposViewOpen = true)}
          section={leftSection}
          onSelectSection={applySection}
          cloudStatus={cloudStatus}
          onOpenProfile={openProfile}
        />
      </div>
      <Splitter orientation="vertical" onResize={(d) => (leftWidth = Math.max(180, Math.min(480, leftWidth + d)))} onCommit={commitLeftWidth} />
    {/if}

    <div class="center">
      <div class="center-main">
        {#if leftSection === "board"}
          <OnboardingBanner
            workspaces={workspaces}
            workspaceRepos={workspaceRepos}
            board={board}
            dismissed={onboardingDismissed}
            onCreateProject={() => (createProjectOpen = true)}
            onManageRepos={() => (leftSection = "repos")}
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
                onOpen={selectCard}
                onPlay={handlePlayCard}
                onApprove={handleApproveCard}
              />
            {/each}
          </main>
        {:else if leftSection === "activity"}
          <ClaimsView
            embedded={true}
            onClose={() => (leftSection = "board")}
            onChanged={() => { if (!connected) refresh(); }}
          />
        {:else if leftSection === "commits"}
          <CommitsView embedded={true} onClose={() => (leftSection = "board")} />
        {:else if leftSection === "agents"}
          <AgentsView
            embedded={true}
            availableRepos={repos}
            onClose={() => (leftSection = "board")}
            onChanged={() => { if (!connected) refresh(); }}
          />
        {:else if leftSection === "integrations"}
          <IntegrationsView
            embedded={true}
            defaultTab={integrationsTab}
            onClose={() => { leftSection = "board"; loadCloudStatus(); }}
            onChanged={() => {
              refreshRepos();
              if (!connected) refresh();
              loadCloudStatus();
            }}
          />
        {:else if leftSection === "permissions"}
          <PermissionsView
            embedded={true}
            availableRepos={repos}
            onClose={() => (leftSection = "board")}
            onChanged={() => { if (!connected) refresh(); }}
          />
        {:else if leftSection === "repos"}
          <ReposView
            embedded={true}
            onClose={() => (leftSection = "board")}
            onChanged={() => {
              refreshRepos();
              if (!connected) refresh();
            }}
          />
        {/if}
      </div>

      {#if bottomOpen}
        <Splitter
          orientation="horizontal"
          onResize={(d) => (bottomHeight = Math.max(120, Math.min(600, bottomHeight - d)))}
          onCommit={commitBottomHeight}
        />
        <div class="bottom-host">
          <BottomPanel
            workspaceId={selectedWorkspaceId}
            tab={bottomTab}
            onSelectTab={setBottomTab}
            onOpenDiff={(runId, file) => (diffTarget = { runId, file })}
          />
        </div>
      {/if}
    </div>

    {#if rightOpen}
      <Splitter orientation="vertical" onResize={(d) => (rightWidth = Math.max(220, Math.min(560, rightWidth - d)))} onCommit={commitRightWidth} />
      <div class="right-host">
        <RightPanel
          selectedTaskId={selectedTaskId}
          onClearSelection={() => (selectedTaskId = null)}
          onSplit={() => {
            if (!selectedTaskId) return;
            const card = findCardById(selectedTaskId);
            if (card) splitTarget = card;
          }}
          onAddSubTask={() => {
            if (!selectedTaskId) return;
            const card = findCardById(selectedTaskId);
            if (card) createSubTaskTarget = card;
          }}
        />
      </div>
    {/if}
  </div>

  <div class="status">
    {#if board}
      <span>{t("topbar.runs", { count: board.active_runs_count })}</span>
      {#if lastUpdated}
        <span class="dot">·</span>
        <span>{t("topbar.last_update", { time: lastUpdated })}</span>
      {/if}
      {#if inFlightMove}
        <span class="dot">·</span>
        <span class="moving">{t("topbar.moving")}</span>
      {/if}
    {/if}
  </div>
</div>

<!-- Genuinely-modal flows (creation forms, prompts) — not driven by the
     left-panel section navigation. Section views (Activity / Commits /
     Agents / Integrations / Permissions / Repos) render inline in the
     center column above. -->
{#if createProjectOpen}
  <CreateProjectDialog
    onClose={() => (createProjectOpen = false)}
    onCreated={(project, openRepos) => {
      createProjectOpen = false;
      refreshWorkspaces().then(() => {
        applyWorkspace(project.id);
        if (openRepos) leftSection = "repos";
      });
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
    onStarted={() => { if (!connected) refresh(); }}
  />
{/if}

{#if createSubTaskTarget}
  <CreateSubTaskDialog
    workItem={createSubTaskTarget}
    availableRepos={repos}
    onClose={() => (createSubTaskTarget = null)}
    onCreated={() => { if (!connected) refresh(); }}
  />
{/if}

{#if splitTarget}
  <SplitDialog
    workItem={splitTarget}
    availableRepos={repos}
    onClose={() => (splitTarget = null)}
    onSplit={() => { if (!connected) refresh(); }}
  />
{/if}

{#if diffTarget}
  <DiffPanel runId={diffTarget.runId} file={diffTarget.file} onClose={() => (diffTarget = null)} />
{/if}

<style>
  :global(body) {
    margin: 0;
    background: var(--bg-app);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    color: var(--text-primary);
    overflow: hidden;
  }
  :global(html), :global(body), :global(#app) { height: 100%; }

  .shell {
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--bg-app);
    color: var(--text-primary);
  }
  .topbar, .error, .status { flex-shrink: 0; }

  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 14px;
    background: var(--bg-surface);
    border-bottom: 1px solid var(--border-default);
    gap: 16px;
    min-height: 44px;
  }
  .topbar-left {
    display: flex;
    align-items: center;
    gap: 16px;
  }
  .topbar-right {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 12px;
    color: var(--text-muted);
  }
  h1 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    color: var(--text-strong);
  }
  .conn.on { color: var(--success); }
  .conn.off { color: var(--warning); }
  .eta-pill {
    background: var(--accent-bg);
    color: var(--accent-text);
    padding: 2px 8px;
    border-radius: 10px;
    font-weight: 500;
  }
  button.primary {
    background: var(--accent);
    color: var(--accent-on);
    border: 1px solid var(--accent);
    border-radius: 4px;
    padding: 5px 12px;
    cursor: pointer;
    font-size: 13px;
  }
  button.primary:hover { background: var(--accent-hover); border-color: var(--accent-hover); }

  .error {
    background: var(--warning-bg);
    color: var(--warning);
    padding: 8px 24px;
    font-size: 13px;
  }

  .grid {
    flex: 1 1 auto;
    display: flex;
    align-items: stretch;
    min-height: 0;
    overflow: hidden;
  }
  .left-host {
    width: var(--left-w);
    flex-shrink: 0;
    border-right: 1px solid var(--border-subtle);
    overflow: hidden;
  }
  .right-host {
    width: var(--right-w);
    flex-shrink: 0;
    border-left: 1px solid var(--border-subtle);
    overflow: hidden;
  }
  .center {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .center-main {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: auto;
  }
  .bottom-host {
    height: var(--bottom-h);
    flex-shrink: 0;
    border-top: 1px solid var(--border-subtle);
    overflow: hidden;
  }

  .board {
    display: grid;
    grid-template-columns: repeat(4, minmax(240px, 1fr));
    gap: 12px;
    padding: 16px;
    align-items: start;
  }

  .status {
    border-top: 1px solid var(--border-subtle);
    background: var(--bg-muted);
    padding: 4px 14px;
    font-size: 11px;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 22px;
  }
  .dot { opacity: 0.5; }
  .moving { color: var(--accent); }
</style>
