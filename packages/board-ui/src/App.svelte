<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import ClaimsView from "./lib/ClaimsView.svelte";
  import Column from "./lib/Column.svelte";
  import CommitsView from "./lib/CommitsView.svelte";
  import CreateSubTaskDialog from "./lib/CreateSubTaskDialog.svelte";
  import CreateTaskDialog from "./lib/CreateTaskDialog.svelte";
  import IntegrationsView from "./lib/IntegrationsView.svelte";
  import AgentsView from "./lib/AgentsView.svelte";
  import UsersView from "./lib/UsersView.svelte";
  import DiffPanel from "./lib/DiffPanel.svelte";
  import OrchestratorControls from "./lib/OrchestratorControls.svelte";
  import PermissionsView from "./lib/PermissionsView.svelte";
  import ReposView from "./lib/ReposView.svelte";
  import SettingsView from "./lib/SettingsView.svelte";
  import ProjectsView from "./lib/ProjectsView.svelte";
  import GeneralSettingsView from "./lib/GeneralSettingsView.svelte";
  import ApiKeysDialog from "./lib/ApiKeysDialog.svelte";
  import AgentPicker from "./lib/AgentPicker.svelte";
  import Toasts from "./lib/Toasts.svelte";
  import { getShowReviewColumn } from "./lib/settings.svelte.js";
  import SplitDialog from "./lib/SplitDialog.svelte";
  import StartPromptDialog from "./lib/StartPromptDialog.svelte";
  import CreateProjectDialog from "./lib/CreateProjectDialog.svelte";
  import LeftPanel, { type SectionKey } from "./lib/shell/LeftPanel.svelte";
  import RightPanel from "./lib/shell/RightPanel.svelte";
  import BottomPanel from "./lib/shell/BottomPanel.svelte";
  import TaskDetailDialog from "./lib/TaskDetailDialog.svelte";
  import ProfileMenu from "./lib/ProfileMenu.svelte";
  import ProfileView from "./lib/ProfileView.svelte";
  import ProjectSelector from "./lib/ProjectSelector.svelte";
  import PanelToggles from "./lib/shell/PanelToggles.svelte";
  import Splitter from "./lib/shell/Splitter.svelte";
  import { t } from "./lib/i18n.svelte.js";
  import {
    fetchBoard,
    fetchCloudStatus,
    fetchCurrentProject,
    fetchRepos,
    fetchAgents,
    fetchProjectsList,
    approveRun,
    moveWorkItem,
    renameProjectById,
    reorderTask,
    setCurrentProjectId,
    startRun,
    type CloudStatus,
    type AgentSummary,
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
  // Cached list of agents for the topbar AgentPicker + preflight
  // checks. Refreshed on workspace switch and whenever the Agents
  // view's onChanged callback fires (so toggling enable / changing
  // model in AgentsView surfaces here within one round-trip).
  let agentsList = $state<AgentSummary[]>([]);
  // Selected agent for the next run, persisted per project. Null
  // means "let the orchestrator pick" (the existing behaviour).
  let selectedAgentId = $state<string | null>(null);
  const PREFERRED_AGENT_KEY_PREFIX = "backlog.preferred_agent.";

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
  let integrationsTab = $state<"github" | "jira" | "sources">("github");

  // ---- shell layout state ----
  let leftOpen = $state(readBool(SHELL_LEFT_OPEN, true));
  let rightOpen = $state(readBool(SHELL_RIGHT_OPEN, false));
  let bottomOpen = $state(readBool(SHELL_BOTTOM_OPEN, false));
  let leftWidth = $state(readNum(SHELL_LEFT_WIDTH, 240, 180, 480));
  let rightWidth = $state(readNum(SHELL_RIGHT_WIDTH, 360, 260, 600));
  let bottomHeight = $state(readNum(SHELL_BOTTOM_HEIGHT, 240, 120, 600));
  let leftSection = $state<SectionKey>("board");
  let selectedTaskId = $state<string | null>(null);
  let diffTarget = $state<{ runId: string; file: string } | null>(null);
  let profileOpen = $state<"signin" | "signup" | null>(null);
  let manageProjectsOpen = $state(false);
  let generalSettingsOpen = $state(false);
  let apiKeysOpen = $state(false);
  // When navigating to the Repos section via the "+ New repository"
  // dropdown action, jump straight into the create form. Reset to
  // false on any other path to the section.
  let reposShowCreate = $state(false);

  // ---- runtime infra ----
  let pollFallback: ReturnType<typeof setInterval> | null = null;
  let sse: BoardSseClient | null = null;
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;

  // Toast surface — run lifecycle notifications. Bound after the
  // <Toasts/> component mounts; null guards on first render.
  let toasts = $state<{ push: (kind: "info" | "success" | "warning" | "error", message: string) => void } | null>(null);

  // Run-status snapshot for diffing across refreshes. Key is the
  // sub-task id; value is the most recently seen {runId, status, label}.
  // We diff this map after each refresh() to detect transitions and
  // emit toasts (start / completed / failed / awaiting_review).
  //
  // `runStatePrimed` defers the first emission so we don't toast for
  // runs that were already in flight when the user opened the project.
  type RunSnap = { runId: string | null; status: string | null; label: string };
  const runState = new Map<string, RunSnap>();
  let runStatePrimed = false;

  async function loadCloudStatus() {
    try {
      cloudStatus = await fetchCloudStatus();
    } catch {
      cloudStatus = { signed_in: false };
    }
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

  // Column visibility — when In Review is hidden (default), review-status
  // tasks are merged into the doing column so they remain visible. The
  // user can still drop into review by editing the task explicitly.
  const showReview = $derived(getShowReviewColumn());
  const visibleColumns = $derived(
    showReview ? COLUMN_ORDER : COLUMN_ORDER.filter((k) => k !== "review"),
  );
  function cardsFor(key: ColumnKey): TaskCard[] {
    if (!board) return [];
    if (key === "doing" && !showReview) {
      return [...board.columns.doing, ...board.columns.review];
    }
    return board.columns[key] ?? [];
  }

  async function refresh() {
    try {
      const opts: { repo?: string } = {};
      if (selectedRepoId) opts.repo = selectedRepoId;
      board = await fetchBoard(opts);
      error = null;
      lastUpdated = new Date().toLocaleTimeString("fr-FR");
      diffRunState(board);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  // Walk the freshly-fetched board, build a snapshot of currently-active
  // runs (subtaskId → {runId, status}), and compare against the previous
  // snapshot stored in runState. Emit one toast per detected transition:
  //
  //   prev=null/queued, curr=running               → "started"
  //   prev=running,     curr=awaiting_review       → "review"
  //   prev=running,     curr=failed/cancelled      → "failed"
  //   prev=running,     curr=∅ (run cleared)       → "completed"
  //
  // The "completed" inference comes from the fact that the board only
  // surfaces the *active* run; once it terminates successfully, the
  // subtask's active_run drops to null. Failures show up explicitly
  // for one tick before clearing — we catch them in the explicit branch.
  function diffRunState(b: BoardResponse): void {
    const next = new Map<string, RunSnap>();
    for (const column of Object.values(b.columns)) {
      for (const card of column) {
        for (const sub of card.tasks) {
          const label = sub.title?.trim() ? sub.title : card.title;
          const runId = sub.active_run?.id ?? null;
          const status = sub.active_run?.status ?? null;
          next.set(sub.id, { runId, status, label });
        }
      }
    }

    if (!runStatePrimed) {
      // First refresh after mount or workspace switch — seed the map
      // without emitting. The user just landed on the page; existing
      // runs are not "starting" from their point of view.
      runState.clear();
      for (const [id, snap] of next) runState.set(id, snap);
      runStatePrimed = true;
      return;
    }

    for (const [id, curr] of next) {
      const prev = runState.get(id);
      const prevRunning = prev?.status === "running" || prev?.status === "queued";
      const currRunning = curr.status === "running" || curr.status === "queued";

      if (!prev && currRunning) {
        // Brand new sub-task already running — rare but possible if a
        // split + auto-approve fires between refreshes. Treat as start.
        toasts?.push("info", t("run.toast.started", { title: curr.label }));
      } else if (prev && curr.runId && prev.runId !== curr.runId && currRunning) {
        // A new run replaced the previous one (retry or fresh attempt).
        toasts?.push("info", t("run.toast.started", { title: curr.label }));
      } else if (prev && !prevRunning && currRunning) {
        toasts?.push("info", t("run.toast.started", { title: curr.label }));
      } else if (prev && prevRunning && curr.status === "awaiting_review") {
        toasts?.push("warning", t("run.toast.review", { title: curr.label }));
      } else if (prev && prevRunning && (curr.status === "failed" || curr.status === "cancelled")) {
        toasts?.push("error", t("run.toast.failed", { title: curr.label }));
      }
    }

    // Sub-tasks present last tick but with active_run cleared this tick
    // → completion. Iterate over prev so we catch ids that disappeared
    // from `next` entirely (e.g. card moved to Done and dropped off the
    // board's task aggregation).
    for (const [id, prev] of runState) {
      const prevRunning = prev.status === "running" || prev.status === "queued" || prev.status === "awaiting_review";
      if (!prevRunning) continue;
      const curr = next.get(id);
      if (!curr || curr.runId === null) {
        toasts?.push("success", t("run.toast.completed", { title: prev.label }));
      }
    }

    runState.clear();
    for (const [id, snap] of next) runState.set(id, snap);
  }

  async function refreshAgents() {
    try { agentsList = await fetchAgents(); }
    catch { agentsList = []; }
    // After loading, seed the selected agent if the user hasn't picked
    // one yet (or their previous pick disappeared from the registry).
    const stored = selectedWorkspaceId
      ? localStorage.getItem(PREFERRED_AGENT_KEY_PREFIX + selectedWorkspaceId)
      : null;
    if (stored && agentsList.some((a) => a.id === stored)) {
      selectedAgentId = stored;
      return;
    }
    // Auto-pick the first ready AI agent (executable provider, has
    // its API key) so the topbar Play button works without forcing
    // the user to open the picker on first launch.
    const firstReady = agentsList.find(
      (a) =>
        !a.needs_api_key &&
        (a.provider === "claude" || a.provider === "codex" || a.provider === "custom"),
    );
    selectedAgentId = firstReady?.id ?? null;
  }

  function persistAgentChoice(id: string | null) {
    selectedAgentId = id;
    if (!selectedWorkspaceId) return;
    const key = PREFERRED_AGENT_KEY_PREFIX + selectedWorkspaceId;
    if (id) localStorage.setItem(key, id);
    else localStorage.removeItem(key);
  }

  // Preflight: is there at least one AI agent ready to run? The old
  // "enabled" toggle is gone — readiness now means "executable provider
  // and the API key is set". The banner directs the user to the API
  // keys dialog when nothing's ready, which is the most common cause.
  const hasReadyAIAgent = $derived(
    agentsList.some(
      (a) =>
        (a.provider === "claude" || a.provider === "codex" || a.provider === "custom") &&
        !a.needs_api_key,
    ),
  );

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
    // Reset the run-status snapshot — the new project's currently-active
    // runs aren't transitions from the user's POV.
    runState.clear();
    runStatePrimed = false;
    refresh();
    refreshRepos();
    refreshAgents();
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
    refreshAgents();
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

  function openActivityPanel() {
    if (!bottomOpen) {
      bottomOpen = true;
      writeBool(SHELL_BOTTOM_OPEN, true);
    }
  }

  async function handlePlayCard(card: TaskCard) {
    error = null;
    openActivityPanel();
    try {
      const runInput: Parameters<typeof startRun>[0] = { task_id: card.id, approve: true };
      if (selectedAgentId) runInput.agent_id = selectedAgentId;
      const result = await startRun(runInput);
      if (result.started.length === 0) {
        // Look across all returned decisions for the most actionable
        // reason. Priority: missing_api_key (one-click fix → open
        // the dialog) → at_capacity (the agent is busy on another
        // run) → missing_capabilities / risk_not_allowed / repo_*
        // → generic.
        const allReasons = [
          ...(result.skipped[0]?.reasons ?? []),
          ...(result.blocked[0]?.reasons ?? []),
          ...(result.waiting[0]?.reasons ?? []),
        ];
        // Strip the agent_blocked: prefix to get the underlying reason.
        const directReasons = allReasons.flatMap((r) => {
          const m = r.match(/^agent_blocked:[^:]+:(.+)$/);
          return m ? [m[1]!] : [r];
        });
        const apiKeyReason = directReasons.find((r) => r.startsWith("missing_api_key:"));
        const atCapacity = directReasons.includes("at_capacity");
        if (apiKeyReason) {
          error = t("card.play_no_api_key");
          apiKeysOpen = true;
        } else if (atCapacity) {
          error = t("card.play_at_capacity");
        } else if (directReasons.includes("risk_not_allowed")) {
          error = t("card.play_risk_not_allowed");
        } else if (directReasons.some((r) => r.startsWith("missing_capabilities:"))) {
          error = t("card.play_missing_capabilities");
        } else if (directReasons.includes("repo_not_allowed") || directReasons.includes("repo_no_access")) {
          error = t("card.play_repo_blocked");
        } else if (directReasons.includes("no_compatible_agent")) {
          // Genuinely no agent at all — likely the workspace has no
          // claude/codex/custom configured. Send the user to Agents.
          error = t("card.play_no_agent");
          leftSection = "agents";
        } else if (allReasons.length > 0) {
          error = t("card.play_skipped", { reason: allReasons[0] });
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

  async function handleTopbarPlay() {
    // Topbar Play takes the next "À faire" card (the one at the top of
    // the todo column — the user's chosen ordering) and starts it.
    // Falls back to the global orchestrator if there's nothing to run
    // so the action still toggles mode for advanced users.
    error = null;
    openActivityPanel();
    if (!board) return;
    const next = board.columns.todo?.[0];
    if (!next) {
      error = t("topbar.play_no_todo");
      return;
    }
    await handlePlayCard(next);
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
  function commitLeftWidth() { writeNum(SHELL_LEFT_WIDTH, leftWidth); }
  function commitRightWidth() { writeNum(SHELL_RIGHT_WIDTH, rightWidth); }
  function commitBottomHeight() { writeNum(SHELL_BOTTOM_HEIGHT, bottomHeight); }

  function applySection(key: SectionKey) {
    leftSection = key;
  }

  function selectCard(card: TaskCard) {
    selectedTaskId = card.id;
    // The detail view replaces the kanban in the center column, so leave
    // the section as "board" — closing the detail returns to the kanban
    // automatically without losing the user's place in navigation.
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

  // Re-pull workspace + board state when the window comes back into focus
  // or the tab becomes visible again. Catches changes made by the CLI in
  // another terminal (a new workspace, a task move, a hook install, …) —
  // SSE handles in-workspace state but not the registry, and background
  // tabs sometimes drop the connection. Debounced so a quick alt-tab
  // doesn't spam the API.
  let focusRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  function refreshOnFocus() {
    if (focusRefreshTimer) clearTimeout(focusRefreshTimer);
    focusRefreshTimer = setTimeout(() => {
      focusRefreshTimer = null;
      void refreshWorkspaces();
      void refreshRepos();
      void refresh();
      void loadCloudStatus();
      // Re-establish SSE if the connection died while backgrounded.
      if (!connected) connectSse();
    }, 80);
  }
  function handleFocus() {
    refreshOnFocus();
  }
  function handleVisibility() {
    if (document.visibilityState === "visible") refreshOnFocus();
  }

  onMount(() => {
    bootstrap();
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);
  });
  onDestroy(() => {
    teardownSse();
    if (refreshTimer) clearTimeout(refreshTimer);
    if (focusRefreshTimer) clearTimeout(focusRefreshTimer);
    window.removeEventListener("focus", handleFocus);
    document.removeEventListener("visibilitychange", handleVisibility);
  });
</script>

<div class="shell" style:--left-w="{leftWidth}px" style:--right-w="{rightWidth}px" style:--bottom-h="{bottomHeight}px">
  <header class="topbar">
    <div class="topbar-left">
      <ProjectSelector
        projects={workspaces}
        selectedId={selectedWorkspaceId}
        onSelect={applyWorkspace}
        onCreateProject={() => (createProjectOpen = true)}
        onManageProjects={() => (manageProjectsOpen = true)}
        onRename={async (id, name) => {
          try {
            await renameProjectById(id, name);
            await refreshWorkspaces();
          } catch (err) {
            error = err instanceof Error ? err.message : String(err);
          }
        }}
      />
      <OrchestratorControls
        onError={(message) => (error = message)}
        onStarted={openActivityPanel}
        onPlay={handleTopbarPlay}
      />
      <AgentPicker
        agents={agentsList}
        selectedId={selectedAgentId}
        onSelect={persistAgentChoice}
        onManageAgents={() => (leftSection = "agents")}
      />
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
      <ProfileMenu
        cloudStatus={cloudStatus}
        onOpenProfile={(mode) => (profileOpen = mode)}
        onOpenSettings={() => (generalSettingsOpen = true)}
        onOpenApiKeys={() => (apiKeysOpen = true)}
        onChanged={loadCloudStatus}
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
          repos={repoOptions}
          selectedRepoId={selectedRepoId}
          onSelectRepo={persistRepo}
          onManageRepos={() => { reposShowCreate = false; leftSection = "repos"; }}
          onCreateRepo={() => { reposShowCreate = true; leftSection = "repos"; }}
          section={leftSection}
          onSelectSection={applySection}
        />
      </div>
      <Splitter orientation="vertical" onResize={(d) => (leftWidth = Math.max(180, Math.min(480, leftWidth + d)))} onCommit={commitLeftWidth} />
    {/if}

    <div class="center">
      <div class="center-main">
        <!-- Wrap on selectedWorkspaceId so switching projects forces every
             section view to remount. Each view fetches its data on mount,
             which is what we want — the API calls now hit the new
             project. Without this, AgentsView / CommitsView / etc. keep
             showing stale data from the previous project. -->
        {#key selectedWorkspaceId}
        {#if selectedTaskId}
          <TaskDetailDialog
            taskId={selectedTaskId}
            embedded={true}
            onClose={() => (selectedTaskId = null)}
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
        {:else if leftSection === "board"}
          {#if agentsList.length > 0 && !hasReadyAIAgent}
            <div class="preflight-banner" role="alert">
              <span class="preflight-icon" aria-hidden="true">🔑</span>
              <div class="preflight-text">
                <strong>{t("preflight.no_api_key.title")}</strong>
                <span>{t("preflight.no_api_key.body")}</span>
              </div>
              <button class="preflight-cta" onclick={() => (apiKeysOpen = true)}>
                {t("preflight.no_api_key.cta")}
              </button>
            </div>
          {/if}
          <main class="board" style:--columns-count={visibleColumns.length}>
            {#each visibleColumns as key (key)}
              <Column
                columnKey={key}
                cards={cardsFor(key)}
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
            onOpenApiKeys={() => (apiKeysOpen = true)}
            onChanged={() => {
              void refreshAgents();
              if (!connected) refresh();
            }}
          />
        {:else if leftSection === "users"}
          <UsersView
            embedded={true}
            onClose={() => (leftSection = "board")}
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
            onOpenProfile={() => (profileOpen = "signin")}
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
            initialShowCreate={reposShowCreate}
            onClose={() => { reposShowCreate = false; leftSection = "board"; }}
            onChanged={() => {
              refreshRepos();
              if (!connected) refresh();
            }}
          />
        {:else if leftSection === "settings"}
          <SettingsView embedded={true} onClose={() => (leftSection = "board")} />
        {/if}
        {/key}
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
            onOpenDiff={(runId, file) => (diffTarget = { runId, file })}
          />
        </div>
      {/if}
    </div>

    {#if rightOpen}
      <Splitter orientation="vertical" onResize={(d) => (rightWidth = Math.max(260, Math.min(600, rightWidth - d)))} onCommit={commitRightWidth} />
      <div class="right-host">
        <RightPanel workspaceId={selectedWorkspaceId} />
      </div>
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

{#if profileOpen}
  <ProfileView
    initialMode={profileOpen}
    onClose={() => { profileOpen = null; loadCloudStatus(); }}
    onChanged={loadCloudStatus}
  />
{/if}

{#if manageProjectsOpen}
  <ProjectsView
    onClose={() => { manageProjectsOpen = false; void refreshWorkspaces(); }}
    onSelect={(id) => applyWorkspace(id)}
    onCreateProject={() => (createProjectOpen = true)}
  />
{/if}

{#if generalSettingsOpen}
  <GeneralSettingsView onClose={() => (generalSettingsOpen = false)} />
{/if}

{#if apiKeysOpen}
  <ApiKeysDialog
    onClose={() => (apiKeysOpen = false)}
    onChanged={() => { void refreshAgents(); }}
  />
{/if}

<!-- Toast surface — fixed bottom-right. Always mounted so we can push
     into it from anywhere (run lifecycle transitions in diffRunState,
     handlePlayCard, etc.). The bind:this exposes its push() method. -->
<Toasts bind:this={toasts} />

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
  .topbar, .error { flex-shrink: 0; }

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
    grid-template-columns: repeat(var(--columns-count, 4), minmax(240px, 1fr));
    gap: 12px;
    padding: 16px;
    align-items: start;
  }

  .preflight-banner {
    margin: 12px 16px 0;
    padding: 10px 14px;
    border: 1px solid var(--warning);
    background: var(--warning-bg);
    border-radius: 6px;
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .preflight-icon {
    font-size: 18px;
    color: var(--warning);
    flex-shrink: 0;
  }
  .preflight-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .preflight-text strong {
    color: var(--warning);
    font-size: 13px;
  }
  .preflight-text span {
    font-size: 12px;
    color: var(--text-body);
    line-height: 1.4;
  }
  .preflight-cta {
    background: var(--warning);
    color: var(--text-inverse);
    border: 1px solid var(--warning);
    border-radius: 4px;
    padding: 5px 12px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    flex-shrink: 0;
  }
  .preflight-cta:hover { opacity: 0.9; }

</style>
