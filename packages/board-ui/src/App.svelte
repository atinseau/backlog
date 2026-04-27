<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import ClaimDialog from "./lib/ClaimDialog.svelte";
  import ClaimsBoard from "./lib/ClaimsBoard.svelte";
  import ClaimsView from "./lib/ClaimsView.svelte";
  import Column from "./lib/Column.svelte";
  import CreateTaskDialog from "./lib/CreateTaskDialog.svelte";
  import CreateTicketDialog from "./lib/CreateTicketDialog.svelte";
  import OrchestratorControls from "./lib/OrchestratorControls.svelte";
  import OrchestratorPanel from "./lib/OrchestratorPanel.svelte";
  import PermissionsView from "./lib/PermissionsView.svelte";
  import RepoSelector from "./lib/RepoSelector.svelte";
  import ReposView from "./lib/ReposView.svelte";
  import SplitDialog from "./lib/SplitDialog.svelte";
  import ViewToggle from "./lib/ViewToggle.svelte";
  import WorkspaceSelector from "./lib/WorkspaceSelector.svelte";
  import {
    fetchBoard,
    fetchCurrentWorkspace,
    fetchRepos,
    fetchWorkspacesList,
    moveWorkItem,
    reorderWorkItem,
    setCurrentWorkspaceId,
  } from "./lib/api.js";
  import { subscribeToBoard, type BoardSseClient } from "./lib/sse.js";
  import { formatDuration } from "./lib/timer.svelte.js";
  import {
    COLUMN_ORDER,
    type BoardResponse,
    type ColumnKey,
    type Repo,
    type WorkItemCard,
    type WorkspaceEntry,
  } from "./lib/types.js";

  const REPO_STORAGE_KEY = "backlog.selected_repo_id";
  const VIEW_STORAGE_KEY = "backlog.kanban_view";
  const WORKSPACE_STORAGE_KEY = "backlog.selected_workspace_id";

  type KanbanView = "tickets" | "claims";

  let board = $state<BoardResponse | null>(null);
  let workspaceRepos = $state<Repo[]>([]);
  let workspaces = $state<WorkspaceEntry[]>([]);
  let selectedWorkspaceId = $state<string | null>(null);
  let selectedRepoId = $state<string | null>(null);
  let view = $state<KanbanView>("tickets");
  let claimsBoardSignal = $state(0);
  let error = $state<string | null>(null);
  let lastUpdated = $state<string | null>(null);
  let inFlightMove = $state<string | null>(null);
  let connected = $state(false);
  let claimDialogOpen = $state(false);
  let claimsViewOpen = $state(false);
  let reposViewOpen = $state(false);
  let permissionsViewOpen = $state(false);
  let createTicketOpen = $state(false);
  let createTaskTarget = $state<WorkItemCard | null>(null);
  let panelOpen = $state(false);
  let splitTarget = $state<WorkItemCard | null>(null);
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
      workspaces = await fetchWorkspacesList();
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

  function persistView(next: KanbanView) {
    view = next;
    localStorage.setItem(VIEW_STORAGE_KEY, next);
  }

  function bumpClaimsBoard() {
    claimsBoardSignal += 1;
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
        if (type === "claim.changed") bumpClaimsBoard();
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
    setCurrentWorkspaceId(id);
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
        const current = await fetchCurrentWorkspace();
        // /workspaces/current returns paths; match against the registry to find the id.
        const match = workspaces.find((w) => w.path === current.root);
        preferred = match?.id ?? workspaces[0]?.id ?? null;
      } catch {
        preferred = workspaces[0]?.id ?? null;
      }
    }
    if (preferred) {
      selectedWorkspaceId = preferred;
      setCurrentWorkspaceId(preferred);
    }
    selectedRepoId = localStorage.getItem(REPO_STORAGE_KEY);
    const storedView = localStorage.getItem(VIEW_STORAGE_KEY);
    if (storedView === "tickets" || storedView === "claims") view = storedView;
    refresh();
    refreshRepos();
    connectSse();
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
      await reorderWorkItem(workItemId, input);
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
      <WorkspaceSelector
        {workspaces}
        selectedId={selectedWorkspaceId}
        onSelect={applyWorkspace}
      />
    {/if}
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
    <ViewToggle value={view} onChange={persistView} />
  </div>
  <div class="meta">
    {#if board}
      {#if board.total_remaining_seconds > 0}
        <span class="eta-pill">⏱ il reste {formatDuration(board.total_remaining_seconds)}</span>
        <span class="dot">·</span>
      {/if}
      <span>{board.active_runs_count} runs ·
        <button class="claims-link" onclick={() => (claimsViewOpen = true)} title="Voir tous les claims">
          {board.active_claims_count} claims
        </button>
      </span>
      <span class="dot">·</span>
      <span class:on={connected} class:off={!connected} class="conn">
        {connected ? "● live" : "○ polling"}
      </span>
      {#if lastUpdated}
        <span class="dot">·</span>
        <span>maj {lastUpdated}</span>
      {/if}
      {#if inFlightMove}
        <span class="dot">·</span>
        <span class="moving">↻ déplacement…</span>
      {/if}
    {/if}
    <button onclick={() => (permissionsViewOpen = true)}>🔒 Permissions</button>
    <button onclick={() => (panelOpen = !panelOpen)}>⚙ Plan</button>
    <button class="primary" onclick={() => (createTicketOpen = true)}>+ Ticket</button>
    <button onclick={() => (claimDialogOpen = true)}>+ Claim</button>
    <button onclick={refresh}>↻</button>
  </div>
</header>

{#if error}
  <div class="error">{error}</div>
{/if}

{#if view === "tickets"}
  <main class="board">
    {#each COLUMN_ORDER as key (key)}
      <Column
        columnKey={key}
        cards={board?.columns[key] ?? []}
        onMove={handleMove}
        onReorder={handleReorder}
        onSplit={(card) => (splitTarget = card)}
        onAddTask={(card) => (createTaskTarget = card)}
      />
    {/each}
  </main>
{:else}
  <ClaimsBoard
    repoFilter={selectedRepoId}
    refreshSignal={claimsBoardSignal}
    onChanged={bumpClaimsBoard}
  />
{/if}

{#if claimDialogOpen}
  <ClaimDialog
    {repos}
    onClose={() => (claimDialogOpen = false)}
    onCreated={() => {
      if (!connected) refresh();
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

{#if permissionsViewOpen}
  <PermissionsView
    availableRepos={repos}
    onClose={() => (permissionsViewOpen = false)}
    onChanged={() => {
      if (!connected) refresh();
    }}
  />
{/if}

{#if createTicketOpen}
  <CreateTicketDialog
    availableRepos={repos}
    onClose={() => (createTicketOpen = false)}
    onCreated={() => {
      if (!connected) refresh();
    }}
  />
{/if}

{#if createTaskTarget}
  <CreateTaskDialog
    workItem={createTaskTarget}
    availableRepos={repos}
    onClose={() => (createTaskTarget = null)}
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
  .claims-link {
    background: transparent;
    border: none;
    padding: 0;
    color: inherit;
    cursor: pointer;
    text-decoration: underline dotted;
    text-underline-offset: 2px;
    font: inherit;
  }
  .claims-link:hover { color: #1570ef; }
  button {
    background: #f2f4f7;
    border: 1px solid #d0d5dd;
    border-radius: 4px;
    padding: 4px 10px;
    cursor: pointer;
    font-size: 14px;
  }
  button:hover { background: #e4e7ec; }
  button.primary {
    background: #1570ef;
    color: white;
    border-color: #1570ef;
  }
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
    align-items: start;
    min-height: calc(100vh - 60px);
  }
</style>
