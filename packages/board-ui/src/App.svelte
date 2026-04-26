<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import Card from "./lib/Card.svelte";
  import { fetchBoard } from "./lib/api.js";
  import { COLUMN_LABELS, COLUMN_ORDER, type BoardResponse } from "./lib/types.js";

  let board = $state<BoardResponse | null>(null);
  let error = $state<string | null>(null);
  let lastUpdated = $state<string | null>(null);
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
    {/if}
    <button onclick={refresh}>↻</button>
  </div>
</header>

{#if error}
  <div class="error">{error}</div>
{/if}

<main class="board">
  {#each COLUMN_ORDER as key (key)}
    {@const cards = board?.columns[key] ?? []}
    <section class="column">
      <header>
        <h2>{COLUMN_LABELS[key]}</h2>
        <span class="count">{cards.length}</span>
      </header>
      <div class="cards">
        {#if !board}
          <div class="placeholder">Chargement…</div>
        {:else if cards.length === 0}
          <div class="placeholder">—</div>
        {:else}
          {#each cards as card (card.id)}
            <Card {card} />
          {/each}
        {/if}
      </div>
    </section>
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
  .column {
    background: #eef0f3;
    border-radius: 8px;
    padding: 10px;
    display: flex;
    flex-direction: column;
    min-height: 200px;
  }
  .column header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
    padding: 0 4px;
  }
  h2 {
    margin: 0;
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #475467;
  }
  .count {
    background: #d0d5dd;
    color: #344054;
    font-size: 11px;
    padding: 1px 7px;
    border-radius: 10px;
  }
  .cards { flex: 1; }
  .placeholder {
    padding: 16px 0;
    text-align: center;
    color: #98a2b3;
    font-size: 13px;
  }
</style>
