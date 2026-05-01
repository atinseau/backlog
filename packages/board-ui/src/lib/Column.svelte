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
    onDiscard?: (card: TaskCard, runId: string) => Promise<void> | void;
    // Card-menu actions — proxied to Card.svelte. Pass-through; the
    // App is the source of truth for what each one does.
    onArchive?: (card: TaskCard) => Promise<void> | void;
    onUnarchive?: (card: TaskCard) => Promise<void> | void;
    onDelete?: (card: TaskCard) => Promise<void> | void;
    onMoveToTop?: (card: TaskCard) => Promise<void> | void;
    onSetPriority?: (card: TaskCard, priority: "P0" | "P1" | "P2" | "P3") => Promise<void> | void;
    onAssign?: (card: TaskCard, assigneeId: string | null) => Promise<void> | void;
    assignees?: Array<{ id: string; label: string; kind: "agent" | "user"; ready?: boolean }>;
  }

  let { columnKey, cards, onMove, onReorder, onSplit, onAddTask, onOpen, onPlay, onApprove, onDiscard, onArchive, onUnarchive, onDelete, onMoveToTop, onSetPriority, onAssign, assignees }: Props = $props();

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
    if (columnKey === "done") {
      localCards = cards;
      return;
    }
    localCards = event.detail.items;
  }

  function isBusy(card: TaskCard): boolean {
    return card.tasks.some((task) => {
      const status = task.active_run?.status;
      return status === "queued" || status === "preparing" || status === "running";
    });
  }

  function isLocked(card: TaskCard): boolean {
    // A card with an active run on any of its subtasks is "in flight"
    // for the executor; letting the user drag it to another column
    // would create a confusing race between the agent's status updates
    // and the manual move. Reject the drop and snap back instead.
    return card.tasks.some((t) => t.active_run !== null);
  }

  function violatesDoingOrder(nextItems: TaskCard[], droppedId: string): boolean {
    if (columnKey !== "doing") return false;
    const droppedCard = nextItems.find((card) => card.id === droppedId);
    if (!droppedCard) return false;
    if (isBusy(droppedCard)) return true;
    const firstBusyIndex = nextItems.findIndex(isBusy);
    if (firstBusyIndex < 0) return false;
    const newIndex = nextItems.findIndex((card) => card.id === droppedId);
    return newIndex >= 0 && newIndex <= firstBusyIndex;
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
    const droppedCard = nextItems.find((c) => c.id === droppedId);

    if (columnKey === "done") {
      localCards = cards;
      return;
    }

    // Reject drops on locked cards — revert the optimistic UI without
    // calling onMove / onReorder. svelte-dnd-action animates the card
    // back to its origin via the FLIP transition.
    if (droppedCard && isLocked(droppedCard)) {
      localCards = cards;
      return;
    }
    if (columnKey === "doing" && !wasAlreadyInColumn && cards.some(isBusy)) {
      localCards = cards;
      return;
    }
    if (violatesDoingOrder(nextItems, droppedId)) {
      localCards = cards;
      return;
    }

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
    class:locked-zone={columnKey === "done"}
    use:dndzone={{
      items: localCards,
      type: "task",
      flipDurationMs: FLIP_MS,
      dropTargetStyle: {},
      dragDisabled: columnKey === "done",
      dropFromOthersDisabled: columnKey === "done",
    }}
    onconsider={handleConsider}
    onfinalize={handleFinalize}
  >
    {#each localCards as card (card.id)}
      <div class="card-shell" class:queue-active={columnKey === "doing" && isBusy(card)} class:queue-waiting={columnKey === "doing" && !isBusy(card)}>
        <Card {card} {onSplit} {onAddTask} {onOpen} {onPlay} {onApprove} {onDiscard} {onArchive} {onUnarchive} {onDelete} {onMoveToTop} {onSetPriority} {onAssign} {assignees} />
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
  .cards.locked-zone {
    cursor: default;
  }
  .card-shell {
    position: relative;
  }
  .card-shell.queue-active::before {
    content: "";
    position: absolute;
    left: -6px;
    top: 8px;
    bottom: 16px;
    width: 3px;
    border-radius: 999px;
    background: var(--success);
    box-shadow: 0 0 10px color-mix(in srgb, var(--success) 45%, transparent);
  }
  .card-shell.queue-waiting {
    opacity: 0.92;
  }
  .placeholder {
    padding: 16px 0;
    text-align: center;
    color: var(--text-subtle);
    font-size: 13px;
  }
</style>
