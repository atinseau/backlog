<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import Column from "./lib/Column.svelte";
  import { fetchBoard, moveWorkItem } from "./lib/api.js";
  import { COLUMN_ORDER, type BoardResponse, type ColumnKey } from "./lib/types.js";

  let board = $state<BoardResponse | null>(null);
  let error = $state<string | null>(null);
  let lastUpdated = $state<string | null>(null);
  let inFlightMove = $state<string | null>(null);
  let timer: ReturnType<typeof setInterval> | null = null;

  async function refresh() {
    try {
      board = await fetchBoard();
      error = null;
      lastUpdated = new Date().toLocaleTimeString("fr-FR");
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  async function handleMove(workItemId: string, toStatus: string, _toColumn: ColumnKey) {
    if (!board) return;
    inFlightMove = workItemId;
    try {
      await moveWorkItem(workItemId, toStatus);
      await refresh();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      await refresh();
    } finally {
      inFlightMove = null;
    }
  }

  onMount(() => {
    refresh();
    timer = setInterval(refresh, 5000);
  });

  onDestroy(() => {
    if (timer) clearInterval(timer);
  });
</script>

<header class="topbar">
  <h1>Backlog Board</h1>
  <div class="meta">
    {#if board}
      <span>{board.workspace}</span>
      <span class="dot">·</span>
      <span>{board.active_runs_count} runs · {board.active_claims_count} claims</span>
      {#if lastUpdated}
        <span class="dot">·</span>
        <span>maj {lastUpdated}</span>
      {/if}
      {#if inFlightMove}
        <span class="dot">·</span>
        <span class="moving">↻ déplacement…</span>
      {/if}
    {/if}
    <button onclick={refresh}>↻</button>
  </div>
</header>

{#if error}
  <div class="error">{error}</div>
{/if}

<main class="board">
  {#each COLUMN_ORDER as key (key)}
    <Column columnKey={key} cards={board?.columns[key] ?? []} onMove={handleMove} />
  {/each}
</main>

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
  button {
    background: #f2f4f7;
    border: 1px solid #d0d5dd;
    border-radius: 4px;
    padding: 4px 10px;
    cursor: pointer;
    font-size: 14px;
  }
  button:hover { background: #e4e7ec; }
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
