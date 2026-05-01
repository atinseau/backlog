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
  import Toasts from "./lib/Toasts.svelte";
  import UpdateBanner from "./lib/UpdateBanner.svelte";
  import CardMenu from "./lib/CardMenu.svelte";
  import { getShowReviewColumn } from "./lib/settings.svelte.js";
  import SplitDialog from "./lib/SplitDialog.svelte";
  import StartPromptDialog from "./lib/StartPromptDialog.svelte";
  import DirectDirtyDialog from "./lib/DirectDirtyDialog.svelte";
  import CreateProjectDialog from "./lib/CreateProjectDialog.svelte";
  import LeftPanel, { type SectionKey } from "./lib/shell/LeftPanel.svelte";
  import RightPanel from "./lib/shell/RightPanel.svelte";
  import BottomPanel from "./lib/shell/BottomPanel.svelte";
  import TaskDetailDialog from "./lib/TaskDetailDialog.svelte";
  import ProfileMenu from "./lib/ProfileMenu.svelte";
  import ProfileView from "./lib/ProfileView.svelte";
  import ProjectSelector from "./lib/ProjectSelector.svelte";
  import RunStatusDisplay from "./lib/RunStatusDisplay.svelte";
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
    fetchUsers,
    approveRun,
    archiveTask,
    cancelRun,
    deleteTask,
    discardRun,
    moveTaskToTop,
    moveWorkItem,
    patchTask,
    renameProjectById,
    reorderTask,
    setCurrentProjectId,
    startRun,
    touchProjectById,
    unarchiveTask,
    type CloudStatus,
    type AgentSummary,
  } from "./lib/api.js";
  import { formatAgentLabel } from "./lib/agent-label.js";
  import { explainStartRunResult, type StartRunAction } from "./lib/run-start-errors.js";
  import type { UserSummary } from "./lib/types.js";
  import { subscribeToBoard, type BoardSseClient } from "./lib/sse.js";
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
  let loadError = $state<string | null>(null);
  let lastUpdated = $state<string | null>(null);
  let inFlightMove = $state<string | null>(null);
  let connected = $state(false);
  // Persist the last known cloud status across reloads/launches so the
  // sidebar doesn't flash "signed out" between page load and the
  // /cloud/status fetch resolving (~1s round-trip if backlog.so is
  // reachable, indefinite if it isn't). The cached value is just a
  // best-effort hint — the real source of truth is still the JWT
  // stored in secrets.json server-side.
  const CLOUD_STATUS_CACHE_KEY = "backlog.cloud_status_cache";
  function readCachedCloudStatus(): CloudStatus | null {
    try {
      const raw = typeof localStorage !== "undefined" ? localStorage.getItem(CLOUD_STATUS_CACHE_KEY) : null;
      return raw ? (JSON.parse(raw) as CloudStatus) : null;
    } catch {
      return null;
    }
  }
  function writeCachedCloudStatus(status: CloudStatus): void {
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(CLOUD_STATUS_CACHE_KEY, JSON.stringify(status));
      }
    } catch {
      // Quota / private-mode — non-fatal, just skip caching.
    }
  }
  let cloudStatus = $state<CloudStatus | null>(readCachedCloudStatus());
  // Cached list of agents for preflight checks and assignee menus.
  // Refreshed on workspace switch and whenever the Agents
  // view's onChanged callback fires (so toggling enable / changing
  // model in AgentsView surfaces here within one round-trip).
  let agentsList = $state<AgentSummary[]>([]);
  let usersList = $state<UserSummary[]>([]);

  // Flat assignee menu — what the card-menu Assign ▸ submenu lists.
  // Agents come first (executable providers), users second. Disabled
  // agents (needs_api_key) stay visible but are flagged so the user
  // sees they exist + knows the key is missing.
  const assigneesForMenu = $derived.by((): Array<{ id: string; label: string; kind: "agent" | "user"; ready?: boolean }> => {
    const out: Array<{ id: string; label: string; kind: "agent" | "user"; ready?: boolean }> = [];
    for (const a of agentsList) {
      const isExec = a.provider === "claude" || a.provider === "codex" || a.provider === "custom";
      if (!isExec) continue;
      out.push({ id: a.id, label: formatAgentLabel(a).short, kind: "agent", ready: !a.needs_api_key });
    }
    for (const u of usersList) {
      if (u.status !== "active") continue;
      out.push({ id: u.id, label: u.display_name || u.email, kind: "user" });
    }
    return out;
  });
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
  let directDirtyPrompt = $state<{ taskId: string; title: string } | null>(null);
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
      const next = await fetchCloudStatus();
      cloudStatus = next;
      writeCachedCloudStatus(next);
    } catch {
      // On fetch error: keep the last known cached status (if any) so
      // a transient network blip doesn't spuriously flip the user to
      // "signed out". Only fall through to the false default if we
      // truly have nothing on hand.
      if (!cloudStatus) cloudStatus = { signed_in: false };
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
      loadError = null;
      lastUpdated = new Date().toLocaleTimeString("fr-FR");
      diffRunState(board);
    } catch (err) {
      loadError = err instanceof Error ? err.message : String(err);
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

  async function refreshUsers() {
    try { usersList = await fetchUsers(); }
    catch { usersList = []; }
  }

  async function refreshAgents() {
    try { agentsList = await fetchAgents(); }
    catch { agentsList = []; }
    // Users + agents share the assignee picker — keep them in sync.
    void refreshUsers();
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

  // True whenever any sub-task on the board has an active run in a
  // status that's actually doing work (running / queued / preparing).
  // Drives the topbar Stop/Play visual + the "all done" toast.
  // awaiting_review doesn't count — the executor finished, the human
  // owns the next move.
  const hasInFlightRun = $derived.by(() => {
    if (!board) return false;
    for (const column of Object.values(board.columns)) {
      for (const card of column) {
        for (const sub of card.tasks) {
          const status = sub.active_run?.status;
          if (status === "running" || status === "queued" || status === "preparing") {
            return true;
          }
        }
      }
    }
    return false;
  });
  // Track previous tick so we can fire the toast exactly once per
  // running → idle transition.
  let previousHasInFlight = $state(false);
  $effect(() => {
    const now = hasInFlightRun;
    if (previousHasInFlight && !now) {
      // We just transitioned from "something running" → "everything
      // settled". Push the all-done toast (success), and refresh
      // agents in case the run cleared an at_capacity slot.
      toasts?.push("success", t("topbar.all_done"));
      void refreshAgents();
    }
    previousHasInFlight = now;
  });

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
    error = null;
    selectedWorkspaceId = id;
    setCurrentProjectId(id);
    localStorage.setItem(WORKSPACE_STORAGE_KEY, id);
    void touchProjectById(id).catch(() => undefined);
    const entry = workspaces.find((workspace) => workspace.id === id);
    if (entry?.path) {
      void window.backlog?.setLastWorkspace?.(entry.path).catch(() => undefined);
    }
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
    let currentWorkspaceId: string | null = null;
    try {
      const current = await fetchCurrentProject();
      const match = workspaces.find((w) => w.path === current.root);
      currentWorkspaceId = match?.id ?? null;
    } catch {
      currentWorkspaceId = null;
    }

    const desktopBridge = typeof window !== "undefined" && Boolean(window.backlog?.setLastWorkspace);
    let preferred = desktopBridge ? currentWorkspaceId : localStorage.getItem(WORKSPACE_STORAGE_KEY);
    const known = new Set(workspaces.map((w) => w.id));
    if (preferred && !known.has(preferred)) {
      localStorage.removeItem(WORKSPACE_STORAGE_KEY);
      preferred = null;
    }
    if (!preferred) {
      preferred = currentWorkspaceId ?? localStorage.getItem(WORKSPACE_STORAGE_KEY) ?? workspaces[0]?.id ?? null;
    }
    if (preferred) {
      selectedWorkspaceId = preferred;
      setCurrentProjectId(preferred);
      localStorage.setItem(WORKSPACE_STORAGE_KEY, preferred);
      void touchProjectById(preferred).catch(() => undefined);
      const entry = workspaces.find((workspace) => workspace.id === preferred);
      if (entry?.path && desktopBridge) {
        void window.backlog?.setLastWorkspace?.(entry.path).catch(() => undefined);
      }
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
      await approveRun(runId, { summary: "Approved from board", merge_strategy: "merge_commit" });
    } catch (err) {
      error = t("card.approve_failed", {
        reason: err instanceof Error ? err.message : String(err),
      });
    } finally {
      if (!connected) await refresh();
    }
  }

  async function handleDiscardCard(card: TaskCard, runId: string) {
    if (typeof window !== "undefined") {
      const ok = window.confirm(t("card.discard_confirm", { title: card.title }));
      if (!ok) return;
    }
    error = null;
    try {
      await discardRun(runId, "Discarded from board");
      toasts?.push("info", t("card.discarded", { title: card.title }));
    } catch (err) {
      error = t("card.discard_failed", {
        reason: err instanceof Error ? err.message : String(err),
      });
    } finally {
      if (!connected) await refresh();
    }
  }

  // ---- Card-menu handlers ----
  // Each one mutates server state then triggers a refresh if SSE
  // isn't connected (otherwise the next event drives the UI). Errors
  // surface in the same shared `error` banner the rest of the board
  // uses — the menu itself stays simple, no per-action toasts.
  async function handleArchiveCard(card: TaskCard) {
    error = null;
    try { await archiveTask(card.id); }
    catch (err) { error = err instanceof Error ? err.message : String(err); }
    finally { if (!connected) await refresh(); }
  }
  async function handleUnarchiveCard(card: TaskCard) {
    error = null;
    try { await unarchiveTask(card.id); }
    catch (err) { error = err instanceof Error ? err.message : String(err); }
    finally { if (!connected) await refresh(); }
  }
  async function handleDeleteCard(card: TaskCard) {
    // Confirm in plain dialog rather than a custom modal — keeps
    // the menu fast on the common path. Cascade is the safe default
    // here: deleting a parent without its sub-tasks would orphan the
    // sub-tasks (their task_id would dangle).
    if (typeof window !== "undefined") {
      const ok = window.confirm(t("card_menu.delete_confirm", { title: card.title }));
      if (!ok) return;
    }
    error = null;
    try { await deleteTask(card.id, { cascade: true }); }
    catch (err) { error = err instanceof Error ? err.message : String(err); }
    finally { if (!connected) await refresh(); }
  }
  async function handleMoveToTopCard(card: TaskCard) {
    error = null;
    try { await moveTaskToTop(card.id); }
    catch (err) { error = err instanceof Error ? err.message : String(err); }
    finally { if (!connected) await refresh(); }
  }
  async function handleSetPriority(card: TaskCard, priority: "P0" | "P1" | "P2" | "P3") {
    if (priority === card.priority) return;
    error = null;
    try { await patchTask(card.id, { priority }); }
    catch (err) { error = err instanceof Error ? err.message : String(err); }
    finally { if (!connected) await refresh(); }
  }
  async function handleAssignCard(card: TaskCard, assigneeId: string | null) {
    error = null;
    // null = clear (let scheduler pick). Otherwise replace the array
    // with a single entry. The schema supports multiple assignees but
    // the card-menu picker is single-pick by design — open the
    // detail dialog for richer multi-assign.
    const preferred_agents = assigneeId ? [assigneeId] : [];
    try { await patchTask(card.id, { preferred_agents }); }
    catch (err) { error = err instanceof Error ? err.message : String(err); }
    finally { if (!connected) await refresh(); }
  }

  // Cancel every in-flight run on the current board. Used by the
  // topbar Stop button when the global orchestrator isn't running
  // but individual runs are. Best-effort per run — one failure
  // doesn't block the others.
  async function handleStopActiveRuns() {
    if (!board) return;
    const runIds: string[] = [];
    for (const column of Object.values(board.columns)) {
      for (const card of column) {
        for (const sub of card.tasks) {
          const status = sub.active_run?.status;
          if (sub.active_run && (status === "running" || status === "queued" || status === "preparing")) {
            runIds.push(sub.active_run.id);
          }
        }
      }
    }
    if (runIds.length === 0) return;
    const results = await Promise.allSettled(runIds.map((id) => cancelRun(id, "Stopped from topbar")));
    const failures = results.filter((r) => r.status === "rejected");
    if (failures.length > 0) {
      const first = failures[0];
      error = first && first.status === "rejected" ? String((first as PromiseRejectedResult).reason) : "cancel failed";
    } else {
      toasts?.push("info", t("topbar.stop_done", { count: runIds.length }));
    }
    if (!connected) await refresh();
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
      const result = await startRun(runInput);
      if (result.started.length === 0) {
        const explanation = explainStartRunResult(result);
        surfaceStartRunBlock(explanation?.message ?? t("card.play_skipped_empty"), explanation?.action ?? null, card);
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

  function surfaceStartRunBlock(message: string, action: StartRunAction, card: Pick<TaskCard, "id" | "title"> | null) {
    if (action === "direct_dirty" && card) {
      error = null;
      directDirtyPrompt = { taskId: card.id, title: card.title };
      return;
    }
    error = message;
    if (action === "api_keys") apiKeysOpen = true;
    if (action === "agents") leftSection = "agents";
  }

  async function startTaskOrThrow(card: Pick<TaskCard, "id" | "title">) {
    const result = await startRun({ task_id: card.id, approve: true });
    if (result.started.length > 0) {
      directDirtyPrompt = null;
      return;
    }
    const explanation = explainStartRunResult(result) ?? {
      message: t("card.play_skipped_empty"),
      action: null,
    };
    surfaceStartRunBlock(explanation.message, explanation.action, card);
    throw new Error(explanation.message);
  }

  async function retryDirtyDirectRun(taskId: string) {
    error = null;
    openActivityPanel();
    const card = findCardById(taskId);
    if (!card) throw new Error(t("direct_dirty.task_missing"));
    try {
      await startTaskOrThrow(card);
    } finally {
      if (!connected) await refresh();
    }
  }

  async function runDirtyTaskInWorktree(taskId: string) {
    error = null;
    openActivityPanel();
    const card = findCardById(taskId);
    if (!card) throw new Error(t("direct_dirty.task_missing"));
    try {
      await patchTask(taskId, { worktree_mode: "isolated_worktree" });
      await startTaskOrThrow(card);
    } finally {
      if (!connected) await refresh();
    }
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
  <UpdateBanner />
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
        externalActive={hasInFlightRun}
        onStopActiveRuns={handleStopActiveRuns}
      />
    </div>
    <div class="topbar-center">
      <RunStatusDisplay board={board} workspaceId={selectedWorkspaceId} onOpenActivity={openActivityPanel} />
    </div>
    <div class="topbar-right">
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

  {#if error || loadError}
    <div class="error">{error ?? loadError}</div>
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
                onDiscard={handleDiscardCard}
                onArchive={handleArchiveCard}
                onUnarchive={handleUnarchiveCard}
                onDelete={handleDeleteCard}
                onMoveToTop={handleMoveToTopCard}
                onSetPriority={handleSetPriority}
                onAssign={handleAssignCard}
                assignees={assigneesForMenu}
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
      // Auto-close the create dialog the moment the task lands. The
      // dialog used to linger on an "applied" screen showing
      // "Tâche créée" / "✓ Tâche créée" — visually duplicating its
      // own header text in the body. Worse, it stacked in front of the
      // StartPromptDialog that opens next, so the user often saw the
      // "created" confirmation, hit Close, and never noticed the
      // "Start now?" prompt — leading to "the task says created but
      // nothing happened" confusion. Now: create dialog closes, start
      // prompt is the single visible follow-up. Clean handoff.
      createTaskOpen = false;
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
    onBlocked={(message, action) => {
      const prompt = startPrompt;
      const card = prompt ? findCardById(prompt.taskId) : null;
      surfaceStartRunBlock(message, action, card ?? (prompt ? { id: prompt.taskId, title: prompt.taskId } : null));
      if (action === "direct_dirty") startPrompt = null;
    }}
    onStarted={() => {
      // Same UX as clicking the card-level Play: pop the bottom
      // Activity panel open so the user immediately sees logs,
      // refresh state if SSE isn't connected yet. Without
      // openActivityPanel here, hitting "Démarrer" silently kicked
      // off a run with no visible feedback — user thought nothing
      // happened.
      openActivityPanel();
      if (!connected) refresh();
    }}
  />
{/if}

{#if directDirtyPrompt}
  <DirectDirtyDialog
    taskTitle={directDirtyPrompt.title}
    onClose={() => (directDirtyPrompt = null)}
    onRetryDirect={() => directDirtyPrompt ? retryDirtyDirectRun(directDirtyPrompt.taskId) : undefined}
    onRunInWorktree={() => directDirtyPrompt ? runDirtyTaskInWorktree(directDirtyPrompt.taskId) : undefined}
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
  <DiffPanel
    runId={diffTarget.runId}
    file={diffTarget.file}
    onClose={() => (diffTarget = null)}
    onApproved={() => {
      // Refresh the board so the card moves out of IN REVIEW. SSE
      // will fire run.changed too, but a direct refresh feels more
      // responsive after the user explicitly clicked Continue.
      void refresh();
    }}
  />
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

<!-- Card kebab / right-click menu — single global instance, driven
     by cardMenuStore. Lives at App-shell level so it sits OUTSIDE
     every card's transformed subtree and outside every dialog/modal.
     Each Card.svelte just calls cardMenuStore.openAt(coords, items)
     to surface it. -->
<CardMenu />

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
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
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
    flex: 0 1 auto;
    min-width: 0;
    justify-self: start;
  }
  .topbar-center {
    display: flex;
    justify-content: center;
    justify-self: center;
    min-width: 0;
  }
  .topbar-right {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 12px;
    color: var(--text-muted);
    flex: 0 0 auto;
    justify-self: end;
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
