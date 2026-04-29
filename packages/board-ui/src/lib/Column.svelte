<script lang="ts">
  import { dndzone } from "svelte-dnd-action";
  import Card from "./Card.svelte";
  import { t } from "./i18n.svelte.js";
  import {
    COLUMN_DEFAULT_STATUS,
    type ColumnKey,
    type TaskCard,
  } from "./types.js";

  const COLUMN_KEY_TO_T: Record<ColumnKey, string> = {
    todo: "column.todo",
    doing: "column.doing",
    review: "column.review",
    done: "column.done",
  };

  interface Props {
    columnKey: ColumnKey;
    cards: TaskCard[];
    onMove: (workItemId: string, toStatus: string, toColumn: ColumnKey) => void;
    onReorder?: (workItemId: string, beforeId: string | null, afterId: string | null) => void;
    onSplit?: (card: TaskCard) => void;
    onAddTask?: (card: TaskCard) => void;
    onOpen?: (card: TaskCard) => void;
    onPlay?: (card: TaskCard) => Promise<void> | void;
    onApprove?: (card: TaskCard, runId: string) => Promise<void> | void;
  }

  let { columnKey, cards, onMove, onReorder, onSplit, onAddTask, onOpen, onPlay, onApprove }: Props = $props();

  const FLIP_MS = 180;

  // The initial-from-prop is intentional: localCards mutates locally
  // during drag-considering and gets re-synced by the $effect below
  // whenever `cards` changes. The reference here only seeds the state.
  // svelte-ignore state_referenced_locally
  let localCards = $state<TaskCard[]>(cards);

  $effect(() => {
    localCards = cards;
  });

  function handleConsider(event: CustomEvent<{ items: TaskCard[] }>) {
    localCards = event.detail.items;
  }

  function handleFinalize(event: CustomEvent<{ items: TaskCard[]; info: { id: string; trigger: string } }>) {
    const nextItems = event.detail.items;
    const trigger = event.detail.info.trigger;
    if (trigger !== "droppedIntoZone") {
      localCards = nextItems;
      return;
    }

    const droppedId = event.detail.info.id;
    const wasAlreadyInColumn = cards.some((card) => card.id === droppedId);

    if (!wasAlreadyInColumn) {
      // Cross-column drop → status change.
      localCards = nextItems;
      const status = COLUMN_DEFAULT_STATUS[columnKey];
      onMove(droppedId, status, columnKey);
      return;
    }

    // Same-column reorder.
    localCards = nextItems;
    const newIndex = nextItems.findIndex((card) => card.id === droppedId);
    const oldIndex = cards.findIndex((card) => card.id === droppedId);
    if (newIndex < 0 || newIndex === oldIndex) return;
    const beforeCard = newIndex > 0 ? nextItems[newIndex - 1] : null;
    const afterCard = newIndex < nextItems.length - 1 ? nextItems[newIndex + 1] : null;
    if (onReorder) {
      // The server expects the IDs of the neighbours in the post-drop order, but its
      // semantics map to "place before X" for upward moves and "place after X" for
      // downward moves.
      const movingUp = newIndex < oldIndex;
      if (movingUp && beforeCard) {
        onReorder(droppedId, beforeCard.id, null);
      } else if (!movingUp && afterCard) {
        onReorder(droppedId, null, afterCard.id);
      } else if (beforeCard) {
        onReorder(droppedId, beforeCard.id, null);
      } else if (afterCard) {
        onReorder(droppedId, null, afterCard.id);
      }
    }
  }
</script>

<section class="column">
  <header>
    <h2>{t(COLUMN_KEY_TO_T[columnKey])}</h2>
    <span class="count">{localCards.length}</span>
  </header>
  <div
    class="cards"
    use:dndzone={{ items: localCards, type: "task", flipDurationMs: FLIP_MS, dropTargetStyle: {} }}
    onconsider={handleConsider}
    onfinalize={handleFinalize}
  >
    {#each localCards as card (card.id)}
      <div>
        <Card {card} {onSplit} {onAddTask} {onOpen} {onPlay} {onApprove} />
      </div>
    {/each}
    {#if localCards.length === 0}
      <div class="placeholder">—</div>
    {/if}
  </div>
</section>

<style>
  .column {
    background: var(--bg-muted);
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
    color: var(--text-secondary);
  }
  .count {
    background: var(--border-strong);
    color: var(--text-body);
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
    color: var(--text-subtle);
    font-size: 13px;
  }
</style>
