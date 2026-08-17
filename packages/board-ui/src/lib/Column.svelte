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
    backlog: "column.backlog",
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
    onArchiveAll?: (columnKey: ColumnKey, cards: TaskCard[]) => Promise<void> | void;
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

  let { columnKey, cards, onMove, onReorder, onSplit, onAddTask, onOpen, onPlay, onApprove, onDiscard, onArchiveAll, onArchive, onUnarchive, onDelete, onMoveToTop, onSetPriority, onAssign, assignees }: Props = $props();

  const FLIP_MS = 180;
  const PAGE_SIZE = 30;

  // The initial-from-prop is intentional: localCards mutates locally
  // during drag-considering and gets re-synced by the $effect below
  // whenever `cards` changes. The reference here only seeds the state.
  // svelte-ignore state_referenced_locally
  let localCards = $state<TaskCard[]>(cards);
  let visibleLimit = $state(PAGE_SIZE);
  let archivingAll = $state(false);

  $effect(() => {
    localCards = cards;
    visibleLimit = Math.min(Math.max(visibleLimit, PAGE_SIZE), Math.max(cards.length, PAGE_SIZE));
  });

  const visibleCards = $derived(localCards.slice(0, visibleLimit));
  const hasMore = $derived(visibleLimit < localCards.length);
  const archivableCards = $derived(localCards.filter((card) => !isLocked(card)));
  const movementDisabled = $derived(columnKey === "done" || columnKey === "review");

  function mergeVisibleWithHidden(nextVisible: TaskCard[]): TaskCard[] {
    const visibleIds = new Set(nextVisible.map((card) => card.id));
    const hidden = cards.filter((card) => !visibleIds.has(card.id));
    return [...nextVisible, ...hidden];
  }

  function loadMore() {
    visibleLimit = Math.min(localCards.length, visibleLimit + PAGE_SIZE);
  }

  function handleScroll(event: Event) {
    const el = event.currentTarget as HTMLElement;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 160) loadMore();
  }

  async function archiveAll() {
    if (!onArchiveAll || archivableCards.length === 0 || archivingAll) return;
    const cardsToArchive = archivableCards;
    const ok = typeof window === "undefined" || window.confirm(t("column.archive_all_confirm", {
      count: cardsToArchive.length,
      column: t(COLUMN_KEY_TO_T[columnKey]),
    }));
    if (!ok) return;
    archivingAll = true;
    const previousCards = localCards;
    const archivedIds = new Set(cardsToArchive.map((card) => card.id));
    localCards = localCards.filter((card) => !archivedIds.has(card.id));
    try {
      await onArchiveAll(columnKey, cardsToArchive);
    } catch (err) {
      localCards = previousCards;
      throw err;
    } finally {
      archivingAll = false;
    }
  }

  function handleConsider(event: CustomEvent<{ items: TaskCard[] }>) {
    if (movementDisabled) {
      localCards = cards;
      return;
    }
    localCards = mergeVisibleWithHidden(event.detail.items);
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
      localCards = mergeVisibleWithHidden(nextItems);
      return;
    }

    const droppedId = event.detail.info.id;
    const wasAlreadyInColumn = cards.some((card) => card.id === droppedId);
    const droppedCard = nextItems.find((c) => c.id === droppedId);

    if (movementDisabled) {
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
      localCards = mergeVisibleWithHidden(nextItems);
      const status = COLUMN_DEFAULT_STATUS[columnKey];
      onMove(droppedId, status, columnKey);
      return;
    }

    // Same-column reorder.
    localCards = mergeVisibleWithHidden(nextItems);
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
    <div class="column-title">
      <h2>{t(COLUMN_KEY_TO_T[columnKey])}</h2>
      <span class="count">{localCards.length}</span>
    </div>
    <button
      type="button"
      class="archive-all"
      onclick={() => { void archiveAll(); }}
      disabled={!onArchiveAll || archivableCards.length === 0 || archivingAll}
      aria-label={t("column.archive_all")}
      title={t("column.archive_all")}
    >
      {archivingAll ? "…" : "⋮"}
    </button>
  </header>
  <div
    class="cards"
    class:locked-zone={movementDisabled}
    onscroll={handleScroll}
    use:dndzone={{
      items: visibleCards,
      type: "task",
      flipDurationMs: FLIP_MS,
      dropTargetStyle: {},
      dragDisabled: movementDisabled,
      dropFromOthersDisabled: movementDisabled,
    }}
    onconsider={handleConsider}
    onfinalize={handleFinalize}
  >
    {#each visibleCards as card (card.id)}
      <div class="card-shell" class:queue-active={columnKey === "doing" && isBusy(card)} class:queue-waiting={columnKey === "doing" && !isBusy(card)}>
        <Card
          {card}
          {onSplit}
          {onAddTask}
          {onOpen}
          {onPlay}
          {onApprove}
          {onDiscard}
          {onArchive}
          {onUnarchive}
          {onDelete}
          {onMoveToTop}
          {onSetPriority}
          {onAssign}
          {assignees}
          manualMovementDisabled={movementDisabled}
        />
      </div>
    {/each}
    {#if localCards.length === 0}
      <div class="placeholder">—</div>
    {:else if hasMore}
      <button type="button" class="load-more" onclick={loadMore}>
        {t("column.load_more", { count: localCards.length - visibleCards.length })}
      </button>
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
    min-height: 0;
    overflow: hidden;
  }
  /* Inerte tant que le conteneur ne déclare pas scroll-snap-type : c'est
     App.svelte qui l'active, uniquement en mode compact et sous pointeur
     grossier. La colonne ne connaît pas le mode du shell.
     Requête de capacité : ne compte pas dans les trois seuils de largeur
     (src/lib/shell/breakpoints.ts). */
  @media (pointer: coarse) {
    .column {
      scroll-snap-align: start;
    }
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
    padding: 0 4px;
    gap: 8px;
  }
  .column-title {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
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
    /* Compteur ovale : gélule, pas un rayon de 10px hors échelle. */
    border-radius: 999px;
  }
  .archive-all {
    flex: 0 0 auto;
    width: 24px;
    height: 24px;
    border: 1px solid transparent;
    border-radius: 4px;
    background: transparent;
    color: var(--text-muted);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    font-size: 13px;
    line-height: 1;
  }
  .archive-all:hover:not(:disabled) {
    background: var(--bg-hover);
    border-color: var(--border-subtle);
    color: var(--text-primary);
  }
  .archive-all:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
  /* 24×24 est conforme en pointeur fin et l'en-tête de colonne est dense
     par construction : on ne grossit que sous pointeur grossier.
     Requête de capacité : hors des trois seuils de largeur. */
  @media (pointer: coarse) {
    .archive-all {
      width: var(--tap-size);
      height: var(--tap-size);
    }
  }
  .cards {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
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
    /* Le halo box-shadow écrit à la main a été retiré : l'élévation ne
       connaît que les cinq tokens --elev-*. Le repère de file d'attente
       reste porté par le rail plein, qui suffit à le lire. */
  }
  .card-shell.queue-waiting {
    opacity: 0.92;
  }
  .placeholder {
    padding: 16px 0;
    text-align: center;
    /* Message d'état vide = contenu lisible : plancher --text-muted. */
    color: var(--text-muted);
    font-size: 13px;
  }
  .load-more {
    width: 100%;
    margin-top: 8px;
    /* Contrôle à fond transparent : son contour doit 3:1 (WCAG 1.4.11). */
    border: 1px dashed var(--border-field);
    border-radius: 6px;
    background: transparent;
    color: var(--text-muted);
    padding: 8px;
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .load-more:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
</style>
