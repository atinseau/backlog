<script lang="ts">
  import { onDestroy, onMount, untrack } from "svelte";
  import ClaimsView from "./lib/ClaimsView.svelte";
  import ClaimsPage from "./lib/ClaimsPage.svelte";
  import Column from "./lib/Column.svelte";
  import BacklogView from "./lib/BacklogView.svelte";
  import CommitsView from "./lib/CommitsView.svelte";
  import CreateSubTaskDialog from "./lib/CreateSubTaskDialog.svelte";
  import CreateTaskDialog from "./lib/CreateTaskDialog.svelte";
  import IntegrationsView from "./lib/IntegrationsView.svelte";
  import InstructionsView from "./lib/InstructionsView.svelte";
  import HooksView from "./lib/HooksView.svelte";
  import AgentsView from "./lib/AgentsView.svelte";
  import UsageView from "./lib/UsageView.svelte";
  import DiffPanel from "./lib/DiffPanel.svelte";
  import OrchestratorControls from "./lib/OrchestratorControls.svelte";
  import RepositoriesView from "./lib/RepositoriesView.svelte";
  import SettingsView from "./lib/SettingsView.svelte";
  import ProjectsView from "./lib/ProjectsView.svelte";
  import GeneralSettingsView from "./lib/GeneralSettingsView.svelte";
  import ApiKeysDialog from "./lib/ApiKeysDialog.svelte";
  import Toasts from "./lib/Toasts.svelte";
  import CardMenu from "./lib/CardMenu.svelte";
  import { getShowBacklogColumn, getShowReviewColumn, setShowBacklogColumn, setShowReviewColumn } from "./lib/settings.svelte.js";
  import SplitDialog from "./lib/SplitDialog.svelte";
  import DirectDirtyDialog from "./lib/DirectDirtyDialog.svelte";
  import CreateProjectDialog from "./lib/CreateProjectDialog.svelte";
  import LeftPanel, { type SectionKey } from "./lib/shell/LeftPanel.svelte";
  import RightPanel from "./lib/shell/RightPanel.svelte";
  import BottomPanel from "./lib/shell/BottomPanel.svelte";
  import TaskDetailDialog from "./lib/TaskDetailDialog.svelte";
  import ProfileMenu from "./lib/ProfileMenu.svelte";
  import ProfileView from "./lib/ProfileView.svelte";
  import ProjectSelector from "./lib/ProjectSelector.svelte";
  import AgentPicker from "./lib/AgentPicker.svelte";
  import ReasoningPicker from "./lib/ReasoningPicker.svelte";
  import RunStatusDisplay from "./lib/RunStatusDisplay.svelte";
  import PanelToggles from "./lib/shell/PanelToggles.svelte";
  import Splitter from "./lib/shell/Splitter.svelte";
  import { BP_NARROW, BP_COMPACT } from "./lib/shell/breakpoints.js";
  import { t } from "./lib/i18n.svelte.js";
  import { isMissingRepositoryPathError, relocateRepositoryPath } from "./lib/repository-relocate.js";
  import {
    fetchBoard,
    fetchCloudStatus,
    fetchCurrentProject,
    fetchRepositories,
    fetchAgents,
    fetchHealth,
    fetchProject,
    fetchProjectsList,
    fetchRuns,
    fetchUsers,
    approveRun,
    archiveTask,
    cancelRun,
    deleteTask,
    discardRun,
    moveTaskToTop,
    moveTask,
    patchTask,
    renameProjectById,
    reorderTask,
    setCurrentProjectId,
    startRun,
    touchProjectById,
    unarchiveTask,
    sortProjectEntries,
    sortRepositories,
    type CloudStatus,
    type AgentSummary,
    type CurrentProject,
    type HealthResponse,
    type ProjectInfo,
  } from "./lib/api.js";
  import { formatAgentLabel } from "./lib/agent-label.js";
  import { defaultReasoningForProvider, isReasoningLevelSupported, loadProviders } from "./lib/providers.svelte.js";
  import { explainStartRunResult, type StartRunAction } from "./lib/run-start-errors.js";
  import type { UserSummary } from "./lib/types.js";
  import { subscribeToBoard, type BoardSseClient } from "./lib/sse.js";
  import {
    COLUMN_ORDER,
    type BoardResponse,
    type ColumnKey,
    type Repository,
    type TaskCard,
    type ProjectEntry,
  } from "./lib/types.js";

  const REPO_STORAGE_KEY = "backlog.selected_repo_id";
  const PROJECT_STORAGE_KEY = "backlog.selected_project_id";
  const PROJECT_PICK_STORAGE_KEY = "backlog.project_picker_requested";
  const AGENT_STORAGE_PREFIX = "backlog.selected_agent_id";
  const REASONING_STORAGE_PREFIX = "backlog.selected_reasoning_effort";
  const LAUNCH_PROJECT_PARAMS = ["project", "workspace"];
  const LAUNCH_REPO_PARAM = "repo";
  const LAUNCH_PICK_PROJECT_PARAM = "pick_project";
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
  const RIGHT_PANEL_MIN = 260;
  const RIGHT_PANEL_MAX = 1040;

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
  function readLaunchParams(): { projectId: string | null; repoId: string | null; pickProject: boolean } {
    if (typeof window === "undefined") {
      return { projectId: null, repoId: null, pickProject: false };
    }
    const params = new URLSearchParams(window.location.search);
    const projectId = LAUNCH_PROJECT_PARAMS.map((key) => params.get(key)).find(Boolean) ?? null;
    return {
      projectId,
      repoId: params.get(LAUNCH_REPO_PARAM),
      pickProject: params.get(LAUNCH_PICK_PROJECT_PARAM) === "1",
    };
  }
  function clearLaunchParams(): void {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    let changed = false;
    for (const key of [...LAUNCH_PROJECT_PARAMS, LAUNCH_REPO_PARAM, LAUNCH_PICK_PROJECT_PARAM]) {
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key);
        changed = true;
      }
    }
    if (changed) {
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }

  // ---- board / data state ----
  let board = $state<BoardResponse | null>(null);
  let projectRepos = $state<Repository[]>([]);
  let projects = $state<ProjectEntry[]>([]);
  let currentProject = $state<CurrentProject | null>(null);
  let selectedProjectId = $state<string | null>(null);
  let selectedRepoId = $state<string | null>(null);
  let selectedAgentId = $state<string | null>(null);
  let selectedReasoningEffort = $state<string | null>(null);
  let error = $state<string | null>(null);
  let loadError = $state<string | null>(null);
  let lastUpdated = $state<string | null>(null);
  let inFlightMove = $state<string | null>(null);
  let connected = $state(false);
  // Persist the last known cloud status across reloads/launches so the
  // sidebar doesn't flash "signed out" between page load and the
  // /cloud/me fetch resolving (~1s round-trip if an account service is
  // configured, indefinite if it isn't). The cached value is just a
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
  // Refreshed on project switch and whenever the Agents
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
      if (!isExecutableAgent(a)) continue;
      out.push({ id: a.id, label: formatAgentLabel(a).withContext, kind: "agent", ready: !a.needs_api_key });
    }
    for (const u of usersList) {
      if (u.status !== "active") continue;
      out.push({ id: u.id, label: u.display_name || u.email, kind: "user" });
    }
    return out;
  });

  function isExecutableAgent(a: AgentSummary): boolean {
    return isExecutableAgent(a);
  }

  function fallbackAgentId(list: AgentSummary[]): string | null {
    const rankAgent = (agent: AgentSummary): number => {
      const id = agent.id.toLowerCase();
      const model = (agent.model ?? "").toLowerCase();
      if (id === "claude-code" || id.includes("sonnet") || model.includes("sonnet")) return 0;
      if (id.includes("opus") || model.includes("opus")) return 1;
      if (agent.provider === "codex" || id.includes("codex") || model.includes("codex")) return 2;
      if (id.includes("haiku") || model.includes("haiku")) return 3;
      return 4;
    };
    const byDefaultOrder = (a: AgentSummary, b: AgentSummary) =>
      rankAgent(a) - rankAgent(b) || (a.display_name ?? a.id).localeCompare(b.display_name ?? b.id);
    const ready = list
      .filter((agent) => isExecutableAgent(agent) && !agent.needs_api_key)
      .sort(byDefaultOrder);
    if (ready.length > 0) return ready[0]?.id ?? null;
    const executable = list.filter(isExecutableAgent).sort(byDefaultOrder);
    return executable[0]?.id ?? null;
  }

  function resolveSelectedAgentId(list: AgentSummary[], current: string | null): string | null {
    if (current && list.some((agent) => agent.id === current && isExecutableAgent(agent))) {
      return current;
    }
    return fallbackAgentId(list);
  }

  const selectedRunAgentId = $derived.by(() => {
    if (agentsList.length === 0) return selectedAgentId;
    return resolveSelectedAgentId(agentsList, selectedAgentId);
  });
  // ---- modal / dialog state ----
  // Section views (Activity / Commits / Agents / Integrations
  // / Repositories) used to be modals; they're now rendered inline in the center
  // when their section is active. The remaining modal state below is for
  // genuinely-modal flows (create / split / start prompt / project create).
  let createProjectOpen = $state(false);
  let createTaskOpen = $state(false);
  let createSubTaskTarget = $state<TaskCard | null>(null);
  let splitTarget = $state<TaskCard | null>(null);
  let directDirtyPrompt = $state<{ taskId: string; title: string } | null>(null);
  let dirtyGitPrompt = $state<TaskCard | null>(null);
  let dirtyGitBypassTaskId = $state<string | null>(null);
  let integrationsTab = $state<"github" | "jira" | "sources">("github");

  // ---- shell layout state ----
  let leftOpen = $state(readBool(SHELL_LEFT_OPEN, true));
  let rightOpen = $state(false);
  let bottomOpen = $state(readBool(SHELL_BOTTOM_OPEN, false));
  let leftWidth = $state(readNum(SHELL_LEFT_WIDTH, 240, 180, 480));
  let rightWidth = $state(readNum(SHELL_RIGHT_WIDTH, 360, RIGHT_PANEL_MIN, RIGHT_PANEL_MAX));
  let bottomHeight = $state(readNum(SHELL_BOTTOM_HEIGHT, 240, 120, 600));

  // ---- responsive shell state ----
  // La largeur du viewport pilote le MODE du shell (expanded / compact /
  // narrow). Elle ne pilote jamais leftWidth / rightWidth / bottomHeight :
  // ces trois-là sont la préférence de l'utilisateur en mode large et
  // doivent survivre intactes à un passage en compact.
  let viewportW = $state(typeof window === "undefined" ? 1280 : window.innerWidth);
  // Inclusive, to match the `@media (max-width: …)` rules that carry the
  // other half of the same layout. With `<`, a viewport of exactly 900px
  // got the CSS narrow rules without the JS class, and the topbar fell
  // back to its three-column desktop grid inside a 900px bar.
  const isCompact = $derived(viewportW <= BP_COMPACT);
  const isNarrow = $derived(viewportW <= BP_NARROW);

  // Ce qui était ouvert avant de passer sous 900px, pour le restaurer en
  // remontant. En mémoire uniquement — jamais localStorage.
  let restoreOnExpand: { left: boolean; right: boolean; bottom: boolean } | null = null;
  let wasCompact = false; // volontairement PAS $state : écrit depuis l'effet.

  // Repli automatique au franchissement descendant, une seule fois par
  // franchissement : en continu, l'utilisateur ne pourrait plus rouvrir un
  // tiroir sous 900. `untrack` garantit qu'un simple toggle ne réveille pas
  // l'effet. On ne touche JAMAIS aux largeurs ni à localStorage ici.
  $effect(() => {
    const compact = isCompact;
    if (compact === wasCompact) return;
    wasCompact = compact;
    untrack(() => {
      if (compact) {
        restoreOnExpand = { left: leftOpen, right: rightOpen, bottom: bottomOpen };
        leftOpen = false;
        rightOpen = false;
        bottomOpen = false;
      } else if (restoreOnExpand) {
        leftOpen = restoreOnExpand.left;
        rightOpen = restoreOnExpand.right;
        bottomOpen = restoreOnExpand.bottom;
        restoreOnExpand = null;
      }
    });
  });

  let leftSection = $state<SectionKey>("board");
  let selectedTaskId = $state<string | null>(null);
  let diffTarget = $state<{ runId: string; file: string } | null>(null);
  let gitDiffTarget = $state<{ repo: string; file: string; sha?: string | null; base?: string | null; head?: string | null; refreshKey: number } | null>(null);
  let gitDiffRefreshKey = $state(0);
  let profileOpen = $state<"signin" | "signup" | null>(null);
  let usageOpen = $state(false);
  let manageProjectsOpen = $state(false);
  let generalSettingsOpen = $state(false);
  let apiKeysOpen = $state(false);
  // When navigating to the Repositories section via the "+ New repository"
  // dropdown action, jump straight into the create form. Reset to
  // false on any other path to the section.
  let reposShowCreate = $state(false);
  const projectShellReady = $derived(Boolean(selectedProjectId));
  const createProjectInitialPath = $derived(currentProject?.transient ? currentProject.repo_only?.root ?? "" : "");
  const createProjectInitialName = $derived(currentProject?.transient ? currentProject.repo_only?.name ?? "" : "");
  const createProjectInitialBranch = $derived(currentProject?.transient ? currentProject.repo_only?.default_branch ?? "main" : "main");
  const showLeftPanel = $derived(Boolean(projectShellReady && leftOpen));
  const showBottomPanel = $derived(Boolean(projectShellReady && bottomOpen));
  const showRightPanel = $derived(Boolean(projectShellReady && rightOpen));

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


  // Repositories visible in the kanban — the "fallback" set when the
  // project has no configured repositories yet.
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
  const repoOptions = $derived.by<Repository[]>(() => {
    if (projectRepos.length > 0) return sortRepositories(projectRepos);
    return boardRepoIds.map((id) => ({ id, path: id, default_branch: "main", enabled: true }));
  });
  const repoGitStatuses = $derived(board?.repo_git_statuses ?? {});
  const repos = $derived(repoOptions.map((r) => r.id));
  function isNotGitRepositoryError(value?: string | null): boolean {
    if (!value) return false;
    return /not a git repository|not inside a git work tree|must be run in a work tree/i.test(value);
  }
  const createTaskHasGitRepository = $derived.by(() => {
    const targets = selectedRepoId ? [selectedRepoId] : repos;
    if (targets.length === 0) return false;
    return targets.some((id) => {
      const repo = repoOptions.find((candidate) => candidate.id === id);
      if (repo?.location === "remote" || repo?.remote_type === "git" || repo?.remote_url || repo?.git_url) return true;
      return !isNotGitRepositoryError(repoGitStatuses[id]?.error);
    });
  });

  // Column visibility — when In Review is hidden (default), review-status
  // tasks are merged into the doing column so they remain visible. The
  // user can still drop into review by editing the task explicitly.
  const showBacklog = $derived(getShowBacklogColumn());
  const showReview = $derived(getShowReviewColumn());
  const visibleColumns = $derived(
    COLUMN_ORDER.filter((k) =>
      (k !== "backlog" || showBacklog) &&
      (k !== "review" || showReview),
    ),
  );
  function cardsFor(key: ColumnKey): TaskCard[] {
    if (!board) return [];
    if (key === "doing" && !showReview) {
      return [...board.columns.doing, ...board.columns.review];
    }
    return board.columns[key] ?? [];
  }

  async function refresh() {
    if (!selectedProjectId) {
      board = null;
      loadError = null;
      lastUpdated = null;
      runState.clear();
      runStatePrimed = false;
      return;
    }
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
      // First refresh after mount or project switch — seed the map
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
    if (!selectedProjectId) {
      usersList = [];
      return;
    }
    try { usersList = await fetchUsers(); }
    catch { usersList = []; }
  }

  async function refreshAgents() {
    if (!selectedProjectId) {
      agentsList = [];
      usersList = [];
      selectedAgentId = null;
      return;
    }
    try { agentsList = await fetchAgents(); }
    catch { agentsList = []; }
    if (agentsList.length > 0) {
      const resolved = resolveSelectedAgentId(agentsList, selectedAgentId);
      if (resolved !== selectedAgentId) persistSelectedAgent(resolved);
    } else if (selectedAgentId) {
      persistSelectedAgent(null);
    }
    // Users + agents share the assignee picker — keep them in sync.
    void refreshUsers();
  }

  // Preflight: keep Play disabled until there is something actionable.
  // We intentionally do not render a checklist on the board; the UI
  // should only interrupt the user when a clicked action needs a clear
  // fix (API key, agent config, workspace, etc.).
  const selectedRunAgent = $derived(
    agentsList.find((agent) => agent.id === selectedRunAgentId) ?? null,
  );
  const selectedRunReasoningProvider = $derived(selectedRunAgent?.provider ?? null);
  const selectedRunReasoningEffort = $derived.by(() => {
    const provider = selectedRunReasoningProvider;
    if (!provider) return null;
    if (isReasoningLevelSupported(provider, selectedReasoningEffort)) return selectedReasoningEffort;
    const stored = readSelectedReasoning(selectedProjectId, provider);
    if (isReasoningLevelSupported(provider, stored)) return stored;
    return defaultReasoningForProvider(provider);
  });
  $effect(() => {
    if (!selectedProjectId || !selectedRunReasoningProvider) {
      selectedReasoningEffort = null;
      return;
    }
    const resolved = selectedRunReasoningEffort;
    if (resolved && resolved !== selectedReasoningEffort) {
      persistSelectedReasoning(resolved);
    }
  });
  const hasReadyAIAgent = $derived(
    Boolean(selectedRunAgent && isExecutableAgent(selectedRunAgent) && !selectedRunAgent.needs_api_key),
  );
  type PreflightItem = {
    label: string;
    ok: boolean;
  };
  const todoCount = $derived(board?.columns.todo?.length ?? 0);
  const hasRunnableWorkspace = $derived(
    repoOptions.some((repo) =>
      repo.enabled !== false &&
      repo.access_mode !== "no-access" &&
      (Boolean(repo.checkout_path ?? repo.path) || Boolean(repo.remote_url)),
    ),
  );
  const preflightItems = $derived.by<PreflightItem[]>(() => [
    {
      label: t("preflight.project"),
      ok: Boolean(selectedProjectId),
    },
    {
      label: t("preflight.workspace"),
      ok: Boolean(selectedProjectId && hasRunnableWorkspace),
    },
    {
      label: t("preflight.agent"),
      ok: Boolean(selectedProjectId && hasReadyAIAgent),
    },
  ]);
  const blockingPreflightItems = $derived(preflightItems.filter((item) => !item.ok));
  const playConfigured = $derived(Boolean(selectedProjectId && board && blockingPreflightItems.length === 0));
  const playState = $derived<"blocked" | "empty" | "ready">(
    !playConfigured ? "blocked" : todoCount > 0 ? "ready" : "empty",
  );
  const playReady = $derived(playState === "ready");
  const playBlockedTitle = $derived(
    playState === "blocked"
      ? blockingPreflightItems[0]?.label ?? t("orchestrator.play.nothing")
      : t("orchestrator.play.nothing"),
  );
  let pendingStartCount = $state(0);

  function isBusyRunStatus(status: string | null | undefined): boolean {
    return status === "running" || status === "queued" || status === "preparing";
  }

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
          if (isBusyRunStatus(status)) {
            return true;
          }
        }
      }
    }
    return false;
  });
  const controlsRunning = $derived(hasInFlightRun || pendingStartCount > 0);
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
    if (!selectedProjectId) {
      projectRepos = [];
      return;
    }
    try {
      const nextRepos = await fetchRepositories();
      projectRepos = nextRepos;
      if (!selectedRepoId && nextRepos.length === 1) {
        const only = nextRepos[0]!;
        selectedRepoId = only.id;
        localStorage.setItem(REPO_STORAGE_KEY, only.id);
        void refresh();
      }
    } catch (err) {
      console.warn("repository fetch failed", err);
    }
  }

  async function refreshProjects() {
    try {
      projects = withTransientProject(await fetchProjectsList(), currentProject);
    } catch (err) {
      console.warn("projects fetch failed", err);
    }
  }

  function transientProjectEntry(info: CurrentProject | null): ProjectEntry | null {
    if (!info?.transient || !info.project_id || !info.repo_only) return null;
    return {
      id: info.project_id,
      path: info.repo_only.root,
      name: info.repo_only.name,
      location: "user_level",
      transient: true,
      added_at: new Date().toISOString(),
    };
  }

  function withTransientProject(list: ProjectEntry[], info: CurrentProject | null): ProjectEntry[] {
    const transient = transientProjectEntry(info);
    if (!transient || list.some((project) => project.id === transient.id)) return sortProjectEntries(list);
    return sortProjectEntries([transient, ...list]);
  }

  function applyProjectBoardSettings(project: ProjectInfo): void {
    setShowBacklogColumn(Boolean(project.board?.show_backlog_column));
    setShowReviewColumn(Boolean(project.review?.show_review_column));
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

  function selectedAgentStorageKey(projectId: string): string {
    return `${AGENT_STORAGE_PREFIX}.${projectId}`;
  }

  function readSelectedAgent(projectId: string | null): string | null {
    if (!projectId || typeof localStorage === "undefined") return null;
    return localStorage.getItem(selectedAgentStorageKey(projectId));
  }

  function persistSelectedAgent(id: string | null) {
    selectedAgentId = id;
    if (!selectedProjectId || typeof localStorage === "undefined") return;
    const key = selectedAgentStorageKey(selectedProjectId);
    if (id) localStorage.setItem(key, id);
    else localStorage.removeItem(key);
  }

  function selectedReasoningStorageKey(projectId: string, provider: string): string {
    return `${REASONING_STORAGE_PREFIX}.${projectId}.${provider}`;
  }

  function readSelectedReasoning(projectId: string | null, provider: string | null): string | null {
    if (!projectId || !provider || typeof localStorage === "undefined") return null;
    return localStorage.getItem(selectedReasoningStorageKey(projectId, provider));
  }

  function persistSelectedReasoning(value: string) {
    selectedReasoningEffort = value;
    if (!selectedProjectId || !selectedRunReasoningProvider || typeof localStorage === "undefined") return;
    localStorage.setItem(selectedReasoningStorageKey(selectedProjectId, selectedRunReasoningProvider), value);
  }

  async function selectRepo(id: string | null) {
    error = null;
    if (!id) {
      persistRepo(null);
      return;
    }
    const repo = repoOptions.find((candidate) => candidate.id === id);
    const status = repoGitStatuses[id];
    if (repo && (repo.path_exists === false || isMissingRepositoryPathError(status?.error))) {
      const checkoutPath = repo.checkout_path ?? repo.path;
      if (!checkoutPath) {
        persistRepo(id);
        return;
      }
      try {
        const relocated = await relocateRepositoryPath(repo.id, checkoutPath);
        if (!relocated) return;
        await refreshRepos();
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
        return;
      }
    }
    persistRepo(id);
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
    if (!selectedProjectId) return;
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

  function applyProject(id: string, options: { repoId?: string | null } = {}) {
    if (id === selectedProjectId) return;
    error = null;
    selectedProjectId = id;
    setCurrentProjectId(id);
    localStorage.setItem(PROJECT_STORAGE_KEY, id);
    localStorage.removeItem(PROJECT_PICK_STORAGE_KEY);
    void touchProjectById(id).catch(() => undefined);
    selectedRepoId = options.repoId ?? null;
    if (selectedRepoId) localStorage.setItem(REPO_STORAGE_KEY, selectedRepoId);
    else localStorage.removeItem(REPO_STORAGE_KEY);
    selectedAgentId = readSelectedAgent(id);
    selectedReasoningEffort = null;
    board = null;
    projectRepos = [];
    selectedTaskId = null;
    // Reset the run-status snapshot — the new project's currently-active
    // runs aren't transitions from the user's POV.
    runState.clear();
    runStatePrimed = false;
    refresh();
    refreshRepos();
    refreshAgents();
    void fetchProject()
      .then(applyProjectBoardSettings)
      .catch(() => undefined);
    connectSse();
  }

  async function bootstrap() {
    await refreshProjects();
    const launch = readLaunchParams();
    let currentProjectId: string | null = null;
    let current: CurrentProject | null = null;
    try {
      const info = await fetchCurrentProject();
      current = info;
      currentProject = info;
      if (info.transient && info.project_id) {
        projects = withTransientProject(projects, info);
        currentProjectId = info.project_id;
      } else {
        const match = projects.find((w) => w.path === info.root);
        currentProjectId = match?.id ?? info.project_id ?? null;
      }
    } catch {
      currentProject = null;
      currentProjectId = null;
    }

    const known = new Set(projects.map((w) => w.id));
    const forcedProject = Boolean(launch.projectId);
    const shouldPickProject = launch.pickProject || localStorage.getItem(PROJECT_PICK_STORAGE_KEY) === "1";
    const storedProjectId = localStorage.getItem(PROJECT_STORAGE_KEY);
    // Cmd+R in Desktop reloads only the renderer; the embedded server's
    // default project does not change until the app restarts. Prefer the
    // renderer's last explicit selection so refresh keeps the project the
    // user is looking at, while ?pick_project=1 still forces the chooser
    // on a fresh Desktop/global launch.
    const currentIsTransient = Boolean(current?.transient && currentProjectId);
    const preferTransientLaunch = currentIsTransient
      && Boolean(launch.repoId || !storedProjectId || !known.has(storedProjectId));
    let preferred = launch.projectId
      ?? (preferTransientLaunch ? currentProjectId : (shouldPickProject ? null : (storedProjectId ?? currentProjectId)));
    if (preferred && !known.has(preferred)) {
      localStorage.removeItem(PROJECT_STORAGE_KEY);
      preferred = null;
    }
    if (!preferred && !shouldPickProject && !forcedProject) {
      preferred = storedProjectId ?? currentProjectId ?? projects[0]?.id ?? null;
    }
    if (preferred) {
      selectedProjectId = preferred;
      setCurrentProjectId(preferred);
      localStorage.setItem(PROJECT_STORAGE_KEY, preferred);
      localStorage.removeItem(PROJECT_PICK_STORAGE_KEY);
      void touchProjectById(preferred).catch(() => undefined);
      const selectedTransientDefault = currentIsTransient && preferred === currentProjectId;
      selectedRepoId = launch.repoId
        ?? (selectedTransientDefault ? current?.repo_only?.repo_id ?? null : localStorage.getItem(REPO_STORAGE_KEY));
      if (selectedRepoId) localStorage.setItem(REPO_STORAGE_KEY, selectedRepoId);
      else localStorage.removeItem(REPO_STORAGE_KEY);
      selectedAgentId = readSelectedAgent(preferred);
      selectedReasoningEffort = null;
    } else if (shouldPickProject) {
      selectedProjectId = null;
      selectedRepoId = null;
      selectedAgentId = null;
      selectedReasoningEffort = null;
      setCurrentProjectId(null);
      localStorage.removeItem(PROJECT_STORAGE_KEY);
      localStorage.removeItem(REPO_STORAGE_KEY);
      localStorage.setItem(PROJECT_PICK_STORAGE_KEY, "1");
    }
    clearLaunchParams();
    refresh();
    refreshRepos();
    refreshAgents();
    if (selectedProjectId) {
      void fetchProject()
        .then(applyProjectBoardSettings)
        .catch(() => undefined);
    }
    connectSse();
    void loadCloudStatus();
  }

  async function handleMove(taskId: string, toStatus: string, _toColumn: ColumnKey) {
    if (!board) return;
    inFlightMove = taskId;
    try {
      await moveTask(taskId, toStatus);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      inFlightMove = null;
      if (!connected) await refresh();
    }
  }

  async function handleReorder(taskId: string, beforeId: string | null, afterId: string | null) {
    try {
      const input: { before_id?: string; after_id?: string } = {};
      if (beforeId) input.before_id = beforeId;
      if (afterId) input.after_id = afterId;
      await reorderTask(taskId, input);
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
  async function handleArchiveColumn(_columnKey: ColumnKey, cards: TaskCard[]) {
    error = null;
    let failed = 0;
    for (const card of cards) {
      try {
        await archiveTask(card.id);
      } catch (err) {
        failed += 1;
        error = err instanceof Error ? err.message : String(err);
      }
    }
    if (failed === 0) {
      toasts?.push("success", t("column.archive_all_done", { count: cards.length }));
    } else {
      error = t("column.archive_all_failed", { failed, count: cards.length });
    }
    await refresh();
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
    const runIds = new Set<string>();
    if (board) {
      for (const column of Object.values(board.columns)) {
        for (const card of column) {
          for (const sub of card.tasks) {
            const status = sub.active_run?.status;
            if (sub.active_run && isBusyRunStatus(status)) {
              runIds.add(sub.active_run.id);
            }
          }
        }
      }
    }
    try {
      const activeRuns = await fetchRuns({ scope: "active" });
      for (const run of activeRuns) {
        if (run.active && isBusyRunStatus(run.status)) runIds.add(run.id);
      }
    } catch (err) {
      console.warn("active run fetch failed", err);
    }
    if (runIds.size === 0) return;
    const ids = Array.from(runIds);
    const results = await Promise.allSettled(ids.map((id) => cancelRun(id, "Stopped from topbar")));
    const failures = results.filter((r) => r.status === "rejected");
    if (failures.length > 0) {
      const first = failures[0];
      error = first && first.status === "rejected" ? String((first as PromiseRejectedResult).reason) : "cancel failed";
    } else {
      toasts?.push("info", t("topbar.stop_done", { count: ids.length }));
    }
    pendingStartCount = 0;
    await refresh();
  }

  function openActivityPanel() {
    if (!bottomOpen) {
      bottomOpen = true;
      writeBool(SHELL_BOTTOM_OPEN, true);
    }
  }

  async function handlePlayCard(card: TaskCard) {
    error = null;
    if (dirtyGitBypassTaskId !== card.id && dirtyGitCountForCard(card) > 0) {
      dirtyGitPrompt = card;
      leftOpen = true;
      writeBool(SHELL_LEFT_OPEN, true);
      applySection("commits");
      return;
    }
    dirtyGitPrompt = null;
    dirtyGitBypassTaskId = null;
    openActivityPanel();
    pendingStartCount += 1;
    try {
      const runInput: Parameters<typeof startRun>[0] = { task_id: card.id, approve: true };
      if (selectedRunAgentId && card.preferred_agents.length === 0) runInput.agent_id = selectedRunAgentId;
      if (selectedRunReasoningEffort) runInput.reasoning_effort = selectedRunReasoningEffort;
      const result = await startRun(runInput);
      if (result.started.length === 0) {
        const explanation = explainStartRunResult(result);
        surfaceStartRunBlock(explanation?.message ?? t("card.play_skipped_empty"), explanation?.action ?? null, card);
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      pendingStartCount = Math.max(0, pendingStartCount - 1);
      if (!connected) await refresh();
    }
  }

  async function handleTopbarPlay() {
    // Topbar Play takes the next "À faire" card (the one at the top of
    // the todo column — the user's chosen ordering) and starts it.
    // Falls back to the global orchestrator if there's nothing to run
    // so the action still toggles mode for advanced users.
    error = null;
    if (!selectedProjectId) {
      error = t("project_prompt.select_required");
      return;
    }
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
  // La persistance est conditionnée au mode large : ouvrir la console sur un
  // téléphone ne doit pas la faire réapparaître au prochain démarrage sur
  // l'écran 27 pouces.
  function toggleLeft() {
    leftOpen = !leftOpen;
    if (!isCompact) writeBool(SHELL_LEFT_OPEN, leftOpen);
  }
  function toggleRight() {
    rightOpen = !rightOpen;
    if (!rightOpen) gitDiffTarget = null;
    if (!isCompact) writeBool(SHELL_RIGHT_OPEN, rightOpen);
  }
  function toggleBottom() {
    bottomOpen = !bottomOpen;
    if (!isCompact) writeBool(SHELL_BOTTOM_OPEN, bottomOpen);
  }
  // Le scrim et Échap ferment les trois tiroirs d'un coup : un seul geste,
  // comportement prévisible.
  const anyDrawerOpen = $derived(showLeftPanel || showRightPanel || showBottomPanel);
  function closeAllDrawers() {
    leftOpen = false;
    rightOpen = false;
    bottomOpen = false;
    gitDiffTarget = null;
  }
  function commitLeftWidth() { writeNum(SHELL_LEFT_WIDTH, leftWidth); }
  function commitRightWidth() { writeNum(SHELL_RIGHT_WIDTH, rightWidth); }
  function commitBottomHeight() { writeNum(SHELL_BOTTOM_HEIGHT, bottomHeight); }

  function applySection(key: SectionKey) {
    if (key !== "commits" && gitDiffTarget) {
      gitDiffTarget = null;
      rightOpen = false;
      writeBool(SHELL_RIGHT_OPEN, false);
    }
    leftSection = key;
    // On a narrow shell the navigator is a full-width drawer, not a
    // sidebar: leaving it open after a pick hides the very view the pick
    // just opened, and the only way out is to hunt the toggle again.
    if (isNarrow && leftOpen) {
      leftOpen = false;
      writeBool(SHELL_LEFT_OPEN, false);
    }
  }

  function openGitDiff(repo: string, file: string, sha?: string | null, base?: string | null, head?: string | null) {
    gitDiffRefreshKey += 1;
    gitDiffTarget = { repo, file, sha, base, head, refreshKey: gitDiffRefreshKey };
    rightOpen = true;
  }

  function closeGitDiff() {
    gitDiffTarget = null;
    rightOpen = false;
    writeBool(SHELL_RIGHT_OPEN, false);
  }

  function dirtyGitCountForCard(card: TaskCard): number {
    if (!board) return 0;
    const repoIds = new Set<string>(card.repo_targets);
    for (const task of card.tasks) repoIds.add(task.repo);
    if (repoIds.size === 0) {
      return Object.values(board.repo_git_statuses).reduce((sum, status) => sum + status.total, 0);
    }
    let total = 0;
    for (const repoId of repoIds) total += board.repo_git_statuses[repoId]?.total ?? 0;
    return total;
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
    if (action === "agents") applySection("agents");
    if (action === "repositories") applySection("repos");
    if (action === "git") applySection("commits");
  }

  async function startTaskOrThrow(card: Pick<TaskCard, "id" | "title">, options: { allowDirtyDirect?: boolean } = {}) {
    const input: Parameters<typeof startRun>[0] = { task_id: card.id, approve: true };
    if (options.allowDirtyDirect) input.allow_dirty_direct = true;
    const fullCard = "preferred_agents" in card ? (card as TaskCard) : findCardById(card.id);
    if (selectedRunAgentId && (!fullCard || fullCard.preferred_agents.length === 0)) input.agent_id = selectedRunAgentId;
    if (selectedRunReasoningEffort) input.reasoning_effort = selectedRunReasoningEffort;
    const result = await startRun(input);
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
    directDirtyPrompt = null;
    error = null;
    openActivityPanel();
    const card = findCardById(taskId);
    if (!card) {
      error = t("direct_dirty.task_missing");
      return;
    }
    try {
      await startTaskOrThrow(card);
    } catch (err) {
      if (!directDirtyPrompt) error = err instanceof Error ? err.message : String(err);
    } finally {
      if (!connected) await refresh();
    }
  }

  async function runDirtyTaskInWorktree(taskId: string) {
    directDirtyPrompt = null;
    error = null;
    openActivityPanel();
    const card = findCardById(taskId);
    if (!card) {
      error = t("direct_dirty.task_missing");
      return;
    }
    try {
      await patchTask(taskId, { worktree_mode: "isolated_worktree" });
      await startTaskOrThrow(card);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      if (!connected) await refresh();
    }
  }

  async function continueDirtyDirectRun(taskId: string) {
    directDirtyPrompt = null;
    error = null;
    openActivityPanel();
    const card = findCardById(taskId);
    if (!card) {
      error = t("direct_dirty.task_missing");
      return;
    }
    try {
      await startTaskOrThrow(card, { allowDirtyDirect: true });
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      if (!connected) await refresh();
    }
  }

  // Re-pull project + board state when the window comes back into focus
  // or the tab becomes visible again. Catches changes made by the CLI in
  // another terminal (a new project, a task move, a hook install, …) —
  // SSE handles in-project state but not the registry, and background
  // tabs sometimes drop the connection. Debounced so a quick alt-tab
  // doesn't spam the API.
  let focusRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  let gitStatusPoll: ReturnType<typeof setInterval> | null = null;
  function refreshOnFocus() {
    if (focusRefreshTimer) clearTimeout(focusRefreshTimer);
    focusRefreshTimer = setTimeout(() => {
      focusRefreshTimer = null;
      void refreshProjects();
      void refreshRepos();
      void refreshAgents();
      void refresh();
      if (selectedProjectId) void loadCloudStatus();
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
    writeBool(SHELL_RIGHT_OPEN, false);
    // The reasoning picker reads its levels from the runtime catalogue.
    void loadProviders();
    void loadCloudStatus();
    bootstrap();
    gitStatusPoll = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 5000);
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);
  });
  onDestroy(() => {
    teardownSse();
    if (refreshTimer) clearTimeout(refreshTimer);
    if (focusRefreshTimer) clearTimeout(focusRefreshTimer);
    if (gitStatusPoll) clearInterval(gitStatusPoll);
    window.removeEventListener("focus", handleFocus);
    document.removeEventListener("visibilitychange", handleVisibility);
  });
</script>

<svelte:window
  bind:innerWidth={viewportW}
  onkeydown={(e) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    if (!isCompact || !anyDrawerOpen) return;
    closeAllDrawers();
  }}
/>

<div class="shell" class:compact={isCompact} class:narrow={isNarrow} style:--left-w="{leftWidth}px" style:--right-w="{rightWidth}px" style:--bottom-h="{bottomHeight}px">
  <header class="topbar">
    <div class="topbar-left">
      <ProjectSelector
        projects={projects}
        selectedId={selectedProjectId}
        onSelect={applyProject}
        onCreateProject={() => (createProjectOpen = true)}
        onManageProjects={() => (manageProjectsOpen = true)}
        onRename={async (id, name) => {
          try {
            await renameProjectById(id, name);
            await refreshProjects();
          } catch (err) {
            error = err instanceof Error ? err.message : String(err);
          }
        }}
      />
      {#if projectShellReady}
        <AgentPicker
          agents={agentsList}
          selectedId={selectedAgentId}
          onSelect={persistSelectedAgent}
          onManageAgents={() => applySection("agents")}
          variant="inline"
        />
        <ReasoningPicker
          provider={selectedRunReasoningProvider}
          value={selectedRunReasoningEffort}
          onSelect={persistSelectedReasoning}
        />
      {/if}
    </div>
    <div class="topbar-center">
      {#if projectShellReady}
        <div class="agent-run-screen">
          <RunStatusDisplay
            board={board}
            projectId={selectedProjectId}
            onOpenActivity={openActivityPanel}
            variant="inline"
          />
        </div>
      {/if}
    </div>
    <div class="topbar-right">
      {#if projectShellReady}
        <OrchestratorControls
          onError={(message) => (error = message)}
          onStarted={openActivityPanel}
          onPlay={handleTopbarPlay}
          externalActive={controlsRunning}
          canPlay={playReady}
          playState={playState}
          playBlockedTitle={playBlockedTitle}
          onStopActiveRuns={handleStopActiveRuns}
        />
        <button class="primary" onclick={() => (createTaskOpen = true)}>{t("topbar.new_task")}</button>
        <!-- Narrow keeps the navigator toggle and drops the other two: all
             three cost ~140px of a 390px bar, but the navigator one is the
             only way back to Claims, Git, Agents and settings once the
             panel has collapsed. -->
        <PanelToggles
          leftOpen={leftOpen}
          bottomOpen={bottomOpen}
          rightOpen={rightOpen}
          onToggleLeft={toggleLeft}
          onToggleBottom={toggleBottom}
          onToggleRight={toggleRight}
          onlyNavigator={isNarrow}
        />
      {/if}
      <ProfileMenu
        cloudStatus={cloudStatus}
        onOpenProfile={(mode) => (profileOpen = mode)}
        onOpenSettings={() => (generalSettingsOpen = true)}
        onOpenIntegrations={() => applySection("integrations")}
        onOpenApiKeys={() => (apiKeysOpen = true)}
        onOpenUsage={() => (usageOpen = true)}
        onChanged={loadCloudStatus}
      />
    </div>
  </header>

  {#if error || loadError}
    <div class="error">{error ?? loadError}</div>
  {/if}

  <div class="grid">
    {#if showLeftPanel}
      <div class="left-host">
        <LeftPanel
          repos={repoOptions}
          repoGitStatuses={repoGitStatuses}
          backlogCount={board?.columns.backlog?.length ?? 0}
          activeClaimsCount={board?.active_claims_count ?? 0}
          selectedRepoId={selectedRepoId}
          onSelectRepo={(id) => { void selectRepo(id); }}
          onManageRepos={() => { reposShowCreate = false; applySection("repos"); }}
          onCreateRepo={() => { reposShowCreate = true; applySection("repos"); }}
          section={leftSection}
          onSelectSection={applySection}
        />
      </div>
      {#if !isCompact}
        <Splitter orientation="vertical" onResize={(d) => (leftWidth = Math.max(180, Math.min(480, leftWidth + d)))} onCommit={commitLeftWidth} />
      {/if}
    {/if}

    <div class="center">
      <div class="center-main">
        <!-- Wrap on selectedProjectId so switching projects forces every
             section view to remount. Each view fetches its data on mount,
             which is what we want — the API calls now hit the new
             project. Without this, AgentsView / CommitsView / etc. keep
             showing stale data from the previous project. -->
        {#key selectedProjectId}
        {#if !selectedProjectId}
          <div class="project-prompt">
            <div class="project-prompt-inner">
              <h2>{t("project_prompt.title")}</h2>
              {#if projects.length === 0}
                <p>{t("project_prompt.empty")}</p>
                <button class="primary" onclick={() => (createProjectOpen = true)}>{t("onboarding.project.cta")}</button>
              {:else}
                <div class="project-choices">
                  {#each projects as project (project.id)}
                    <button class="project-choice" onclick={() => applyProject(project.id)}>
                      <span>{project.name}</span>
                      <small>{project.path}</small>
                    </button>
                  {/each}
                </div>
                <div class="project-prompt-actions">
                  <button onclick={() => (manageProjectsOpen = true)}>{t("selector.manage_projects")}</button>
                  <button class="primary" onclick={() => (createProjectOpen = true)}>{t("selector.new_project_short")}</button>
                </div>
              {/if}
            </div>
          </div>
        {:else if selectedTaskId}
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
                onArchiveAll={handleArchiveColumn}
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
        {:else if leftSection === "backlog"}
          <BacklogView
            embedded={true}
            items={board?.columns.backlog ?? []}
            availableRepositories={repos}
            onClose={() => applySection("board")}
            onChanged={() => { if (!connected) refresh(); else void refresh(); }}
            onOpen={selectCard}
          />
        {:else if leftSection === "claims"}
          <ClaimsPage
            embedded={true}
            repoFilter={selectedRepoId}
            onClose={() => applySection("board")}
            onChanged={() => { if (!connected) refresh(); else void refresh(); }}
            onOpenDiff={openGitDiff}
          />
        {:else if leftSection === "activity"}
          <ClaimsView
            embedded={true}
            onClose={() => applySection("board")}
            onChanged={() => { if (!connected) refresh(); }}
          />
        {:else if leftSection === "commits"}
          <CommitsView
            embedded={true}
            selectedRepoId={selectedRepoId}
            onClose={() => applySection("board")}
            onOpenDiff={openGitDiff}
            onCommitted={() => { if (!connected) refresh(); }}
          />
        {:else if leftSection === "agents"}
          <AgentsView
            embedded={true}
            availableRepos={repos}
            onClose={() => applySection("board")}
            onOpenApiKeys={() => (apiKeysOpen = true)}
            onChanged={() => {
              void refreshAgents();
              if (!connected) refresh();
            }}
          />
        {:else if leftSection === "integrations"}
          <IntegrationsView
            embedded={true}
            defaultTab={integrationsTab}
            onClose={() => { applySection("board"); loadCloudStatus(); }}
            onChanged={() => {
              refreshRepos();
              if (!connected) refresh();
              loadCloudStatus();
            }}
            onOpenProfile={() => (profileOpen = "signin")}
          />
        {:else if leftSection === "repos"}
          <RepositoriesView
            embedded={true}
            initialShowCreate={reposShowCreate}
            onClose={() => { reposShowCreate = false; applySection("board"); }}
            onChanged={() => {
              refreshRepos();
              if (!connected) refresh();
            }}
          />
        {:else if leftSection === "instructions"}
          <InstructionsView
            embedded={true}
            onClose={() => applySection("board")}
          />
        {:else if leftSection === "hooks"}
          <HooksView
            embedded={true}
            onClose={() => applySection("board")}
            onChanged={() => {
              refreshRepos();
              if (!connected) refresh();
            }}
          />
        {:else if leftSection === "settings"}
          <SettingsView embedded={true} onClose={() => applySection("board")} />
        {/if}
        {/key}
      </div>

      {#if showBottomPanel}
        {#if !isCompact}
          <Splitter
            orientation="horizontal"
            onResize={(d) => (bottomHeight = Math.max(120, Math.min(600, bottomHeight - d)))}
            onCommit={commitBottomHeight}
          />
        {/if}
        <div class="bottom-host">
          <BottomPanel
            projectId={selectedProjectId}
            onOpenDiff={(runId, file) => (diffTarget = { runId, file })}
          />
        </div>
      {/if}
    </div>

    {#if showRightPanel}
      {#if !isCompact}
        <Splitter orientation="vertical" onResize={(d) => (rightWidth = Math.max(RIGHT_PANEL_MIN, Math.min(RIGHT_PANEL_MAX, rightWidth - d)))} onCommit={commitRightWidth} />
      {/if}
      <div class="right-host">
        <RightPanel
          projectId={selectedProjectId}
          gitDiffTarget={gitDiffTarget}
          onCloseGitDiff={closeGitDiff}
        />
      </div>
    {/if}

    {#if isCompact && anyDrawerOpen}
      <!-- Sortie au doigt d'un tiroir en surimpression. Un <button> plutôt
           qu'un <div onclick> : focusable, activable au clavier, et son
           aria-label dit ce qu'il fait. -->
      <button
        type="button"
        class="scrim"
        aria-label={t("shell.close_panel")}
        onclick={closeAllDrawers}
      ></button>
    {/if}
  </div>

</div>

<!-- Genuinely-modal flows (creation forms, prompts) — not driven by the
     left-panel section navigation. Section views (Activity / Commits /
     Agents / Integrations / Repositories) render inline in the
     center column above. -->
{#if createProjectOpen}
  <CreateProjectDialog
    initialPath={createProjectInitialPath}
    initialName={createProjectInitialName}
    initialBranch={createProjectInitialBranch}
    onClose={() => (createProjectOpen = false)}
    onCreated={(project, openRepos) => {
      createProjectOpen = false;
      refreshProjects().then(() => {
        applyProject(project.id);
        if (openRepos) applySection("repos");
      });
    }}
  />
{/if}

{#if createTaskOpen}
  <CreateTaskDialog
    availableRepos={repos}
    agents={agentsList}
    agentId={selectedRunAgentId}
    hasGitRepository={createTaskHasGitRepository}
    onClose={() => (createTaskOpen = false)}
    onCreated={() => {
      createTaskOpen = false;
      void refresh();
      toasts?.push("success", t("create_task.applied.success"));
    }}
  />
{/if}

{#if directDirtyPrompt}
  <DirectDirtyDialog
    taskTitle={directDirtyPrompt.title}
    onClose={() => (directDirtyPrompt = null)}
    onRetryDirect={() => directDirtyPrompt ? retryDirtyDirectRun(directDirtyPrompt.taskId) : undefined}
    onRunInWorktree={() => directDirtyPrompt ? runDirtyTaskInWorktree(directDirtyPrompt.taskId) : undefined}
    onContinueAnyway={() => directDirtyPrompt ? continueDirtyDirectRun(directDirtyPrompt.taskId) : undefined}
  />
{/if}

{#if dirtyGitPrompt}
  <div class="backdrop" onclick={() => (dirtyGitPrompt = null)} role="presentation">
    <div
      class="dirty-git-modal"
      onclick={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal="true"
      tabindex={-1}
      onkeydown={(e) => { if (e.key === "Escape") dirtyGitPrompt = null; }}
    >
      <h2>{t("git.run_warning.title")}</h2>
      <p>{t("git.run_warning.body", { count: dirtyGitCountForCard(dirtyGitPrompt) })}</p>
      <div class="dirty-actions">
        <button
          onclick={() => {
            leftOpen = true;
            if (!isCompact) writeBool(SHELL_LEFT_OPEN, true);
            applySection("commits");
            dirtyGitPrompt = null;
          }}
        >
          {t("git.run_warning.review")}
        </button>
        <button
          class="primary"
          onclick={() => {
            const card = dirtyGitPrompt;
            if (card) dirtyGitBypassTaskId = card.id;
            dirtyGitPrompt = null;
            if (card) void handlePlayCard(card);
          }}
        >
          {t("git.run_warning.continue")}
        </button>
      </div>
    </div>
  </div>
{/if}

{#if createSubTaskTarget}
  <CreateSubTaskDialog
    workItem={createSubTaskTarget}
    availableRepos={repos}
    onClose={() => (createSubTaskTarget = null)}
    onCreated={() => { void refresh(); }}
  />
{/if}

{#if splitTarget}
  <SplitDialog
    workItem={splitTarget}
    availableRepos={repos}
    onClose={() => (splitTarget = null)}
    onSplit={(result) => {
      void refresh();
      toasts?.push("success", t("split_dialog.created", { count: result.created_tasks.length }));
    }}
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

{#if usageOpen}
  <UsageView onClose={() => (usageOpen = false)} />
{/if}

{#if manageProjectsOpen}
  <ProjectsView
    onClose={() => { manageProjectsOpen = false; void refreshProjects(); }}
    onSelect={(id) => applyProject(id)}
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
    /* Avec body { overflow: hidden }, 100vh place le bas de la console sous
       la barre d'URL mobile : hors d'atteinte, sans défilement possible.
       La première ligne est le repli des moteurs anciens. */
    height: 100vh;
    height: 100dvh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--bg-app);
    color: var(--text-primary);
  }
  .topbar, .error { flex-shrink: 0; }

  .topbar {
    display: grid;
    /* Track 3 floors at min-content: the right cluster ends in the primary
       action and must never be clipped or spill leftward over the run
       screen. Track 1 stays a plain 1fr and absorbs the shortfall by
       clipping its pickers — losing the tail of a model name is cheap,
       losing "+ Task" is not. Both stay 1fr while there is room, so the
       run screen still reads as centred on a wide window. */
    grid-template-columns: minmax(0, 1fr) auto minmax(min-content, 1fr);
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
    /* `justify-self: start` would size this item to its content and let it
       spill out of its grid track, sliding under the centred run screen —
       the pickers inside carry their own min-width, so the item never
       shrinks on its own. Filling the track and clipping makes the overlap
       impossible at every width, not just below a breakpoint. */
    justify-self: stretch;
    overflow: hidden;
  }
  .topbar-center {
    display: flex;
    align-items: center;
    justify-content: center;
    justify-self: center;
    gap: 8px;
    min-width: 0;
  }
  .agent-run-screen {
    width: min(460px, 36vw);
    /* No min-width floor. A 360px floor made the three topbar tracks add
       up to ~1155px, so the bar overlapped itself on the whole
       900–1155px band — the half-screen scene. RunStatusDisplay degrades
       on its own below that. */
    min-width: 0;
    height: 34px;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    align-items: center;
    padding: 4px 12px;
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    background: var(--bg-elevated);
    color: var(--text-primary);
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
  button:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .error {
    background: var(--warning-bg);
    color: var(--warning);
    padding: 8px 24px;
    font-size: 13px;
  }
  .backdrop {
    position: fixed;
    inset: 0;
    background: var(--backdrop);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 120;
  }
  .dirty-git-modal {
    width: min(460px, calc(100vw - 32px));
    background: var(--bg-surface);
    color: var(--text-primary);
    border: 1px solid var(--border-default);
    border-radius: 8px;
    box-shadow: var(--shadow-modal);
    padding: 18px;
  }
  .dirty-git-modal h2 {
    margin: 0 0 8px;
    font-size: 16px;
  }
  .dirty-git-modal p {
    margin: 0;
    color: var(--text-body);
    font-size: 13px;
    line-height: 1.5;
  }
  .dirty-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 16px;
  }
  .dirty-actions button {
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    background: var(--bg-surface);
    color: var(--text-primary);
    padding: 7px 10px;
    font: inherit;
    cursor: pointer;
  }
  .dirty-actions button.primary {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--accent-on);
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
  .project-prompt {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 32px;
  }
  .project-prompt-inner {
    width: min(560px, 100%);
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .project-prompt h2 {
    margin: 0;
    /* Display = 18px, le plus grand corps du système. */
    font-size: 18px;
    color: var(--text-primary);
  }
  .project-prompt p {
    margin: 0;
    color: var(--text-secondary);
    font-size: 13px;
  }
  .project-choices {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .project-choice {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 2px;
    background: var(--bg-surface);
    color: var(--text-primary);
    border: 1px solid var(--border-default);
    border-radius: 6px;
    padding: 10px 12px;
    text-align: left;
    cursor: pointer;
  }
  .project-choice:hover {
    background: var(--bg-hover);
    border-color: var(--border-strong);
  }
  .project-choice span {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .project-choice small {
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .project-prompt-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .project-prompt-actions button,
  .project-prompt-inner > button {
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    background: var(--bg-surface);
    color: var(--text-primary);
    padding: 7px 10px;
    font: inherit;
    cursor: pointer;
  }
  .project-prompt-actions button.primary,
  .project-prompt-inner > button.primary {
    background: var(--accent);
    color: var(--accent-on);
    border-color: var(--accent);
  }
  .bottom-host {
    height: var(--bottom-h);
    flex-shrink: 0;
    border-top: 1px solid var(--border-subtle);
    overflow: hidden;
  }

  .board {
    flex: 1 1 auto;
    min-height: 0;
    display: grid;
    grid-template-columns: repeat(var(--columns-count, 4), minmax(240px, 1fr));
    gap: 12px;
    padding: 16px;
    align-items: stretch;
    /* .board est étiré à la largeur exacte de .center-main (min-width:auto
       vaut 0 dans l'axe transversal d'un flex column) : les pistes
       débordaient et `overflow: hidden` les découpait silencieusement. `auto`
       les rend atteignables sans rien changer quand elles tiennent.
       `overscroll-behavior-x: contain` empêche le défilement horizontal du
       board de déclencher le retour arrière du navigateur. */
    overflow-x: auto;
    overflow-y: hidden;
    overscroll-behavior-x: contain;
    scroll-padding-inline: 16px;
  }

  /* ---- Mode compact (< 900px) : les panneaux cèdent, le canvas ne cède
     pas. Le seuil vit en JS (src/lib/shell/breakpoints.ts) et arrive ici par
     la classe .compact, pas par un @media — une seule source. ---- */
  .shell.compact .grid {
    /* Restreint au compact : en mode large .grid reste non positionné, donc
       aucun descendant absolu d'une vue feuille ne change d'ancrage. */
    position: relative;
  }
  .shell.compact .left-host,
  .shell.compact .right-host,
  .shell.compact .bottom-host {
    position: absolute;
    z-index: 60;
  }
  .shell.compact .left-host {
    top: 0;
    bottom: 0;
    left: 0;
    width: min(var(--left-w), 86vw);
    box-shadow: var(--elev-floating);
  }
  .shell.compact .right-host {
    top: 0;
    bottom: 0;
    right: 0;
    width: min(var(--right-w), 86vw);
    box-shadow: var(--elev-panel-left);
  }
  .shell.compact .bottom-host {
    left: 0;
    right: 0;
    bottom: 0;
    height: min(var(--bottom-h), 60dvh);
    box-shadow: var(--elev-panel-top);
  }
  .scrim {
    position: absolute;
    inset: 0;
    z-index: 55;
    border: 0;
    padding: 0;
    background: var(--backdrop);
    cursor: pointer;
  }
  .scrim:focus-visible {
    outline: 2px solid var(--accent);
    /* Négatif : le scrim est en inset 0, un offset positif sortirait de
       .grid et serait rogné. */
    outline-offset: -2px;
  }

  /* ---- Mode narrow (< 640px) : tiroirs pleine largeur, une colonne par
     écran ---- */
  .shell.narrow .left-host,
  .shell.narrow .right-host {
    width: 100%;
  }
  .shell.narrow .bottom-host {
    height: min(var(--bottom-h), 70dvh);
  }
  .shell.narrow .board {
    padding: 12px;
    gap: 8px;
    /* Une colonne pleine largeur + 24px de la suivante qui dépassent :
       l'affordance de balayage. 100vw est correct ici parce que les
       tiroirs surimpriment au lieu de pousser le canvas. Si un jour les
       tiroirs repassent dans le flux sous 640, cette piste devient plus
       large que le canvas et le board déborde en permanence. */
    grid-template-columns: repeat(var(--columns-count, 4), minmax(240px, calc(100vw - 44px)));
    scroll-padding-inline: 12px;
  }

  /* Snap réservé au pointeur grossier : en pointeur fin, svelte-dnd-action
     fait de l'auto-scroll de conteneur pendant un glisser, et un conteneur
     qui re-snappe rend ce glisser saccadé. `proximity`, jamais `mandatory`.
     Requête de capacité : ne compte pas dans les trois seuils de largeur. */
  @media (pointer: coarse) {
    .shell.compact .board {
      scroll-snap-type: x proximity;
    }
  }

  /* ---- Topbar en compact ---- */
  .shell.compact .topbar {
    gap: 8px;
    padding: 6px 10px;
  }
  .shell.compact .topbar-left {
    gap: 8px;
  }

  /* ---- Topbar en narrow : deux rangées ---- */
  .shell.narrow .topbar {
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
      "left right"
      "center center";
    row-gap: 6px;
  }
  /* stretch, not start — see the base rule: `start` sizes the item to its
     content and lets it spill under the right cluster. */
  .shell.narrow .topbar-left { grid-area: left; justify-self: stretch; }
  .shell.narrow .topbar-right { grid-area: right; justify-self: end; }
  .shell.narrow .topbar-center { grid-area: center; justify-self: stretch; }
  .shell.narrow .agent-run-screen { width: 100%; }

</style>
