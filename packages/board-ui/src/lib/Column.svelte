<script lang="ts">
  import { dndzone } from "svelte-dnd-action";
  import Card from "./Card.svelte";
  import {
    COLUMN_DEFAULT_STATUS,
    COLUMN_LABELS,
    type ColumnKey,
    type WorkItemCard,
  } from "./types.js";

  interface Props {
    columnKey: ColumnKey;
    cards: WorkItemCard[];
    onMove: (workItemId: string, toStatus: string, toColumn: ColumnKey) => void;
    onSplit?: (card: WorkItemCard) => void;
  }

  let { columnKey, cards, onMove, onSplit }: Props = $props();

  const FLIP_MS = 180;

  let localCards = $state<WorkItemCard[]>(cards);

  $effect(() => {
    localCards = cards;
  });

  function handleConsider(event: CustomEvent<{ items: WorkItemCard[] }>) {
    localCards = event.detail.items;
  }

  function handleFinalize(event: CustomEvent<{ items: WorkItemCard[]; info: { id: string; trigger: string } }>) {
    localCards = event.detail.items;
    const trigger = event.detail.info.trigger;
    if (trigger === "droppedIntoZone") {
      const droppedId = event.detail.info.id;
      const status = COLUMN_DEFAULT_STATUS[columnKey];
      onMove(droppedId, status, columnKey);
    }
  }
</script>

<section class="column">
  <header>
    <h2>{COLUMN_LABELS[columnKey]}</h2>
    <span class="count">{localCards.length}</span>
  </header>
  <div
    class="cards"
    use:dndzone={{ items: localCards, type: "work-item", flipDurationMs: FLIP_MS, dropTargetStyle: {} }}
    onconsider={handleConsider}
    onfinalize={handleFinalize}
  >
    {#each localCards as card (card.id)}
      <div>
        <Card {card} {onSplit} />
      </div>
    {/each}
    {#if localCards.length === 0}
      <div class="placeholder">—</div>
    {/if}
  </div>
</section>

<style>
  .column {
    background: #eef0f3;
    border-radius: 8px;
    padding: 10px;
    display: flex;
    flex-direction: column;
    min-height: 200px;
  }
  header {
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
  .cards {
    flex: 1;
    min-height: 60px;
  }
  .placeholder {
    padding: 16px 0;
    text-align: center;
    color: #98a2b3;
    font-size: 13px;
  }
</style>
