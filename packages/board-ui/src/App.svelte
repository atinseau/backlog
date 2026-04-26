<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import ClaimDialog from "./lib/ClaimDialog.svelte";
  import Column from "./lib/Column.svelte";
  import CreateTaskDialog from "./lib/CreateTaskDialog.svelte";
  import CreateTicketDialog from "./lib/CreateTicketDialog.svelte";
  import OrchestratorControls from "./lib/OrchestratorControls.svelte";
  import OrchestratorPanel from "./lib/OrchestratorPanel.svelte";
  import ProjectSelector from "./lib/ProjectSelector.svelte";
  import ProjectsView from "./lib/ProjectsView.svelte";
  import SplitDialog from "./lib/SplitDialog.svelte";
  import { fetchBoard, fetchProjects, moveWorkItem, reorderWorkItem } from "./lib/api.js";
  import { subscribeToBoard, type BoardSseClient } from "./lib/sse.js";
  import { formatDuration } from "./lib/timer.svelte.js";
  import {
    COLUMN_ORDER,
    type BoardResponse,
    type ColumnKey,
    type Project,
    type WorkItemCard,
  } from "./lib/types.js";

  const PROJECT_STORAGE_KEY = "backlog.selected_project_id";

  let board = $state<BoardResponse | null>(null);
  let projects = $state<Project[]>([]);
  let selectedProjectId = $state<string | null>(null);
  let error = $state<string | null>(null);
  let lastUpdated = $state<string | null>(null);
  let inFlightMove = $state<string | null>(null);
  let connected = $state(false);
  let claimDialogOpen = $state(false);
  let projectsViewOpen = $state(false);
  let createTicketOpen = $state(false);
  let createTaskTarget = $state<WorkItemCard | null>(null);
  let panelOpen = $state(false);
  let splitTarget = $state<WorkItemCard | null>(null);
  let pollFallback: ReturnType<typeof setInterval> | null = null;
  let sse: BoardSseClient | null = null;
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;

  const repos = $derived.by(() => {
    if (!board) return [];
    const set = new Set<string>();
    for (const column of Object.values(board.columns)) {
      for (const card of column) {
        for (const repo of card.repo_targets) set.add(repo);
        for (const task of card.tasks) set.add(task.repo);
      }
    }
    return [...set].sort();
  });

  async function refresh() {
    try {
      const opts = selectedProjectId ? { project: selectedProjectId } : {};
      board = await fetchBoard(opts);
      error = null;
      lastUpdated = new Date().toLocaleTimeString("fr-FR");
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  async function refreshProjects() {
    try {
      projects = await fetchProjects();
    } catch (err) {
      // Don't surface project errors as fatal — backlog without projects is still functional.
      console.warn("project fetch failed", err);
    }
  }

  function scheduleRefresh() {
    if (refreshTimer) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      refresh();
    }, 150);
  }

  function persistProject(id: string | null) {
    selectedProjectId = id;
    if (id) localStorage.setItem(PROJECT_STORAGE_KEY, id);
    else localStorage.removeItem(PROJECT_STORAGE_KEY);
    refresh();
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
    selectedProjectId = localStorage.getItem(PROJECT_STORAGE_KEY);
    refresh();
    refreshProjects();
    sse = subscribeToBoard(
      (type) => {
        if (type === "ping" || type === "ready") return;
        scheduleRefresh();
        if (type === "project.changed") refreshProjects();
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
  });

  onDestroy(() => {
    sse?.close();
    if (pollFallback) clearInterval(pollFallback);
    if (refreshTimer) clearTimeout(refreshTimer);
  });
</script>

<header class="topbar">
  <div class="topbar-left">
    <h1>Backlog</h1>
    <ProjectSelector
      {projects}
      selectedId={selectedProjectId}
      onSelect={persistProject}
      onManage={() => (projectsViewOpen = true)}
    />
    <OrchestratorControls
      {selectedProjectId}
      onError={(message) => (error = message)}
    />
  </div>
  <div class="meta">
    {#if board}
      {#if board.total_remaining_seconds > 0}
        <span class="eta-pill">⏱ {formatDuration(board.total_remaining_seconds)} restantes</span>
        <span class="dot">·</span>
      {/if}
      <span>{board.active_runs_count} runs · {board.active_claims_count} claims</span>
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
    <button onclick={() => (panelOpen = !panelOpen)}>⚙ Plan</button>
    <button class="primary" onclick={() => (createTicketOpen = true)}>+ Ticket</button>
    <button onclick={() => (claimDialogOpen = true)}>+ Claim</button>
    <button onclick={refresh}>↻</button>
  </div>
</header>

{#if error}
  <div class="error">{error}</div>
{/if}

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

{#if claimDialogOpen}
  <ClaimDialog
    {repos}
    onClose={() => (claimDialogOpen = false)}
    onCreated={() => {
      if (!connected) refresh();
    }}
  />
{/if}

{#if projectsViewOpen}
  <ProjectsView
    availableRepos={repos}
    onClose={() => (projectsViewOpen = false)}
    onChanged={() => {
      refreshProjects();
    }}
  />
{/if}

{#if createTicketOpen}
  <CreateTicketDialog
    {projects}
    availableRepos={repos}
    {selectedProjectId}
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
    {selectedProjectId}
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
