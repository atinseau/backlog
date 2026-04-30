<script lang="ts">
  import RetryBadge from "./RetryBadge.svelte";
  import CardMenu from "./CardMenu.svelte";
  import type { MenuItem } from "./card-menu-types.js";
  import { t } from "./i18n.svelte.js";
  import { formatDuration, formatRemaining, useTimer } from "./timer.svelte.js";
  import type { TaskCard } from "./types.js";
  import { onDestroy } from "svelte";

  interface Props {
    card: TaskCard;
    onSplit?: (card: TaskCard) => void;
    onAddTask?: (card: TaskCard) => void;
    onOpen?: (card: TaskCard) => void;
    onPlay?: (card: TaskCard) => Promise<void> | void;
    onApprove?: (card: TaskCard, runId: string) => Promise<void> | void;
    // Card-menu actions. The card itself wires the trigger (3-dot button
    // + right-click) and renders the menu; the parent decides what
    // happens on each action so it can also refresh / undo / show
    // toasts. Each handler is optional — items with no handler are
    // hidden so a smaller embed can opt out.
    onArchive?: (card: TaskCard) => Promise<void> | void;
    onUnarchive?: (card: TaskCard) => Promise<void> | void;
    onDelete?: (card: TaskCard) => Promise<void> | void;
    onMoveToTop?: (card: TaskCard) => Promise<void> | void;
    onSetPriority?: (card: TaskCard, priority: "P0" | "P1" | "P2" | "P3") => Promise<void> | void;
    // Assign sets execution_defaults.preferred_agents on the task.
    // Pass an id to assign, null to clear ("auto"). The list of
    // available assignees is supplied by the parent so we don't
    // re-fetch per card.
    onAssign?: (card: TaskCard, assigneeId: string | null) => Promise<void> | void;
    assignees?: Array<{ id: string; label: string; kind: "agent" | "user"; ready?: boolean }>;
  }

  let { card, onSplit, onAddTask, onOpen, onPlay, onApprove, onArchive, onUnarchive, onDelete, onMoveToTop, onSetPriority, onAssign, assignees }: Props = $props();

  const timer = useTimer();
  onDestroy(() => timer.release());

  const priorityClass = $derived(`pri pri-${card.priority.toLowerCase()}`);
  // Used on the <article> to colour-code the left border by priority.
  const cardPriorityClass = $derived(`prio-${card.priority.toLowerCase()}`);
  const blockedCount = $derived(card.blocked_by_claims.length);
  const runningCount = $derived(card.tasks.filter((t) => t.active_run !== null).length);
  // A card is "locked" while any of its subtasks has an active run —
  // the executor owns its status, dragging is blocked at the dndzone
  // level (Column.svelte), and we surface the state visually with a
  // not-allowed cursor + faded outline.
  const locked = $derived(runningCount > 0);
  // Subtasks that the scheduler could pick up if asked to start now.
  // "queued" and "planned" both mean "ready, just hasn't been launched
  // yet"; "waiting" still has unmet deps so we don't count it.
  const startableCount = $derived(
    card.tasks.filter((t) => t.status === "queued" || t.status === "planned").length,
  );
  // Show ▶ whenever the scheduler has something to start — including
  // EN COURS cards that still have queued siblings, so the user can
  // fan out parallel runs without opening the orchestrator panel.
  // Cards with zero subtasks fall back to the À FAIRE columns since
  // there's nothing else to gate on.
  const canPlay = $derived(
    Boolean(onPlay) &&
      blockedCount === 0 &&
      (startableCount > 0 ||
        (card.tasks.length === 0 && (card.status === "ready" || card.status === "backlog"))),
  );
  let starting = $state(false);
  let approving = $state(false);

  // Find a subtask whose run is awaiting_review — that's the one the
  // ✓ button approves. Cards in EN REVUE typically have exactly one
  // such subtask; if multiple, we approve the first (the agent
  // pattern is one run per subtask anyway).
  const awaitingReviewSubtask = $derived(
    card.tasks.find((t) => t.active_run?.status === "awaiting_review") ?? null,
  );
  const canApprove = $derived(Boolean(onApprove) && awaitingReviewSubtask !== null);

  function handleSplitClick(event: MouseEvent) {
    event.stopPropagation();
    onSplit?.(card);
  }

  function handleAddTaskClick(event: MouseEvent) {
    event.stopPropagation();
    onAddTask?.(card);
  }

  async function handlePlayClick(event: MouseEvent) {
    event.stopPropagation();
    if (!onPlay || starting) return;
    starting = true;
    try {
      await onPlay(card);
    } finally {
      starting = false;
    }
  }

  async function handleApproveClick(event: MouseEvent) {
    event.stopPropagation();
    if (!onApprove || approving) return;
    const runId = awaitingReviewSubtask?.active_run?.id;
    if (!runId) return;
    approving = true;
    try {
      await onApprove(card, runId);
    } finally {
      approving = false;
    }
  }

  // Track press position so we don't open the dialog when the user actually
  // started a drag — svelte-dnd-action moves the card after ~5px of motion.
  let pressX = 0;
  let pressY = 0;
  let pressing = false;

  function handlePointerDown(event: PointerEvent) {
    if (!onOpen) return;
    pressX = event.clientX;
    pressY = event.clientY;
    pressing = true;
  }

  function handleClick(event: MouseEvent) {
    if (!onOpen || !pressing) return;
    pressing = false;
    const dx = Math.abs(event.clientX - pressX);
    const dy = Math.abs(event.clientY - pressY);
    if (dx > 5 || dy > 5) return;
    const target = event.target as HTMLElement;
    // Don't open when the click was on a button, link, or anything inside one.
    if (target.closest("button, a")) return;
    onOpen(card);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (!onOpen) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpen(card);
    }
  }

  // ---- Card menu (3-dot button + right-click) ----
  let menuOpen = $state(false);
  let menuAnchor = $state<{ x: number; y: number } | null>(null);
  const isArchived = $derived(Boolean((card as TaskCard & { archived_at?: string }).archived_at));

  function openMenuAt(x: number, y: number) {
    menuAnchor = { x, y };
    menuOpen = true;
  }

  function handleMenuButtonClick(event: MouseEvent) {
    event.stopPropagation();
    const btn = event.currentTarget as HTMLElement;
    const r = btn.getBoundingClientRect();
    // Anchor the menu just below the 3-dot button so the user keeps
    // their cursor on it without having to chase across the card.
    openMenuAt(r.right - 6, r.bottom + 4);
  }

  function handleContextMenu(event: MouseEvent) {
    if (!onArchive && !onDelete && !onMoveToTop && !onSetPriority) return;
    event.preventDefault();
    event.stopPropagation();
    openMenuAt(event.clientX, event.clientY);
  }

  function copyId() {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(card.id);
    }
  }

  // Build menu items lazily on each open so the disabled state, the
  // archived/unarchived label, and the priority sub-items reflect the
  // current card snapshot.
  const menuItems = $derived.by((): MenuItem[] => {
    const items: MenuItem[] = [];
    if (onOpen) items.push({ label: t("card_menu.edit"), icon: "✎", onSelect: () => onOpen?.(card) });
    items.push({ label: t("card_menu.copy_id", { id: card.id }), icon: "⧉", onSelect: copyId });
    if (onSetPriority) {
      items.push({
        label: t("card_menu.set_priority"),
        icon: "★",
        submenu: (["P0", "P1", "P2", "P3"] as const).map((p) => ({
          label: p === card.priority ? `${p}  •` : p,
          onSelect: () => onSetPriority?.(card, p),
        })),
      });
    }
    if (onMoveToTop) {
      items.push({ label: t("card_menu.move_to_top"), icon: "⤒", onSelect: () => onMoveToTop?.(card), disabled: locked });
    }
    if (onAssign && assignees && assignees.length > 0) {
      // Build the submenu: "Auto" first (clear assignment), then a
      // separator, then agents, then a separator, then users. Each
      // entry shows a • next to whoever is currently assigned.
      const currentAssignee = (card as TaskCard & { preferred_agents?: string[] }).preferred_agents?.[0];
      const submenu: MenuItem[] = [
        {
          label: t("card_menu.assign_auto") + (currentAssignee ? "" : "  •"),
          icon: "✱",
          onSelect: () => onAssign?.(card, null),
        },
      ];
      const agents = assignees.filter((a) => a.kind === "agent");
      const users = assignees.filter((a) => a.kind === "user");
      if (agents.length > 0) {
        submenu.push({ separator: true, label: "" });
        for (const a of agents) {
          submenu.push({
            label: a.label + (a.id === currentAssignee ? "  •" : "") + (a.ready === false ? "  🔑" : ""),
            icon: "🤖",
            onSelect: () => onAssign?.(card, a.id),
            disabled: a.ready === false,
          });
        }
      }
      if (users.length > 0) {
        submenu.push({ separator: true, label: "" });
        for (const u of users) {
          submenu.push({
            label: u.label + (u.id === currentAssignee ? "  •" : ""),
            icon: "👤",
            onSelect: () => onAssign?.(card, u.id),
          });
        }
      }
      items.push({
        label: t("card_menu.assign"),
        icon: "→",
        submenu,
      });
    }
    if (onArchive || onUnarchive) {
      items.push({ separator: true, label: "" });
      if (isArchived && onUnarchive) {
        items.push({ label: t("card_menu.unarchive"), icon: "↺", onSelect: () => onUnarchive?.(card) });
      } else if (onArchive) {
        items.push({ label: t("card_menu.archive"), icon: "📦", onSelect: () => onArchive?.(card), disabled: locked });
      }
    }
    if (onDelete) {
      items.push({ label: t("card_menu.delete"), icon: "✕", onSelect: () => onDelete?.(card), danger: true, disabled: locked });
    }
    return items;
  });

  const hasMenu = $derived(menuItems.length > 0);
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
<article
  class="card {cardPriorityClass}"
  class:clickable={Boolean(onOpen)}
  class:locked
  class:archived={isArchived}
  title={locked ? t("card.locked_running") : undefined}
  onpointerdown={handlePointerDown}
  onclick={handleClick}
  oncontextmenu={handleContextMenu}
  onkeydown={handleKeydown}
  role={onOpen ? "button" : undefined}
  tabindex={onOpen ? 0 : undefined}
>
  <header>
    <h3>{card.title}</h3>
    {#if hasMenu}
      <button
        type="button"
        class="kebab"
        aria-label={t("card.menu_label")}
        onclick={handleMenuButtonClick}
      >⋮</button>
    {/if}
  </header>

  <div class="meta">
    <span class={priorityClass} title={t("card.priority", { value: card.priority })}>{card.priority}</span>
    {#each card.repo_targets as repo (repo)}
      <span class="chip repo">{repo}</span>
    {/each}
  </div>

  {#if card.tasks.length > 0}
    <ul class="tasks">
      {#each card.tasks as task (task.id)}
        <li class:running={task.active_run !== null} class:claimed={task.active_claim !== null}>
          <div class="task-line">
            <span class="task-title">{task.title}</span>
            <span class="task-eta">
              {#if task.eta && task.active_run}
                {formatRemaining(task.eta, timer.now) ?? formatDuration(task.estimated_duration_seconds)}
              {:else}
                ~{formatDuration(task.estimated_duration_seconds)}
              {/if}
            </span>
          </div>
          <span class="task-meta">
            {task.repo}
            {#if task.active_run}
              · {task.active_run.status} ({task.active_run.agent_id})
            {/if}
            {#if task.active_claim}
              · 🔒 {task.active_claim.topic}
              <RetryBadge
                expiresAt={task.active_claim.expires_at}
                expectedFinishAt={task.active_claim.expected_finish_at}
              />
            {/if}
          </span>
          <!-- Per-subtask progress bar removed — the .card-progress at
               the bottom of the card already aggregates and avoided
               doubling up when a card has a single subtask (the most
               common case after the auto-shim). -->
        </li>
      {/each}
    </ul>
  {/if}

  {#if card.blocked_by_claims.length > 0}
    <ul class="blockers">
      {#each card.blocked_by_claims as claim (claim.id)}
        <li>
          <span>{t("card.blocked", { topic: claim.topic + (claim.agent_id ? ` (${claim.agent_id})` : "") })}</span>
          <RetryBadge
            expiresAt={claim.expires_at}
            expectedFinishAt={claim.expected_finish_at}
            blocking
          />
        </li>
      {/each}
    </ul>
  {/if}

  {#if card.tasks.length > 0}
    <div class="card-footer">
      <div class="card-progress" aria-label={t("card.progress_aria")}>
        <div class="card-progress-fill" style:width="{card.progress_percent}%"></div>
      </div>
      <div class="card-stats">
        <span>{card.progress_percent}%</span>
        <span class="dot">·</span>
        <span>{t("card.remaining", { duration: formatDuration(card.remaining_seconds) })}</span>
        {#if runningCount > 0}<span class="dot">·</span><span class="badge running">▶ {runningCount}</span>{/if}
        {#if blockedCount > 0}<span class="dot">·</span><span class="badge blocked">⚠ {blockedCount}</span>{/if}
      </div>
    </div>
  {:else if blockedCount > 0 || runningCount > 0}
    <footer>
      {#if runningCount > 0}<span class="badge running">▶ {runningCount}</span>{/if}
      {#if blockedCount > 0}<span class="badge blocked">⚠ {blockedCount} blocked</span>{/if}
    </footer>
  {/if}

  <CardMenu open={menuOpen} items={menuItems} anchor={menuAnchor} onClose={() => (menuOpen = false)} />

  {#if canPlay || canApprove || (onSplit && card.tasks.length === 0) || onAddTask}
    <div class="actions">
      {#if canPlay}
        <button
          class="icon-btn play"
          onclick={handlePlayClick}
          disabled={starting}
          aria-label={t("card.play")}
          title={t("card.play")}
        >{starting ? "…" : "▶"}</button>
      {/if}
      {#if canApprove}
        <button
          class="icon-btn approve"
          onclick={handleApproveClick}
          disabled={approving}
          aria-label={t("card.approve")}
          title={t("card.approve")}
        >{approving ? "…" : "✓"}</button>
      {/if}
      {#if onSplit && card.tasks.length === 0}
        <button class="icon-btn" onclick={handleSplitClick} aria-label={t("card.split")} title={t("card.split")}>✂</button>
      {/if}
      {#if onAddTask}
        <button class="icon-btn" onclick={handleAddTaskClick} aria-label={t("card.add_subtask")} title={t("card.add_subtask")}>+</button>
      {/if}
    </div>
  {/if}
</article>

<style>
  .card {
    background: var(--bg-surface);
    color: var(--text-primary);
    border-radius: 6px;
    padding: 10px 12px;
    margin-bottom: 8px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
    /* Left border colour conveys priority at a glance during a column
       scan; the textual P0/P1/… pill in the meta row is the
       a11y-friendly fallback. */
    border-left: 3px solid var(--card-accent, var(--border-strong));
    cursor: grab;
    transition: box-shadow 120ms ease, transform 120ms ease;
  }
  .card.prio-p0 { --card-accent: #d92d20; }
  .card.prio-p1 { --card-accent: #f79009; }
  .card.prio-p2 { --card-accent: #2e90fa; }
  .card.prio-p3 { --card-accent: var(--text-subtle); }
  /* Locked = a run is in flight on one of its subtasks. The cursor
     hint prevents the user from expecting drag-to-move behaviour;
     the actual reject lives in Column.svelte's handleFinalize so the
     drop just snaps back. */
  .card.locked { cursor: not-allowed; }
  .card.locked.clickable:hover { transform: none; }
  .card.clickable:hover {
    box-shadow: 0 2px 6px rgba(16, 24, 40, 0.12);
    transform: translateY(-1px);
  }
  .card.clickable:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  header {
    margin-bottom: 6px;
    display: flex;
    align-items: flex-start;
    gap: 6px;
  }
  h3 {
    margin: 0;
    font-size: 14px;
    line-height: 1.3;
    /* Title takes full width — priority moved out to .meta. */
    overflow-wrap: anywhere;
    flex: 1 1 auto;
    min-width: 0;
  }
  .kebab {
    flex-shrink: 0;
    width: 22px;
    height: 22px;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--text-subtle);
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
    border-radius: 4px;
    opacity: 0;
    transition: opacity 100ms ease, background 100ms ease, color 100ms ease;
    /* Pulled in from the card edge so the dot trio sits visually
       inside the padding without crowding the priority pill. */
    margin-right: -4px;
    margin-top: -2px;
  }
  .card:hover .kebab,
  .card:focus-within .kebab,
  .kebab:focus-visible {
    opacity: 1;
  }
  .kebab:hover {
    background: var(--bg-hover, rgba(0, 0, 0, 0.06));
    color: var(--text-primary);
  }
  /* Archived cards: still clickable / present, but visually muted so
     they read as "shelved". The board hides them by default — when a
     filter pulls them back into view this style flags them. */
  .card.archived {
    opacity: 0.55;
    border-left-color: var(--text-subtle);
  }
  .card.archived h3 {
    text-decoration: line-through;
    text-decoration-color: var(--text-subtle);
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    margin-bottom: 6px;
    font-size: 10px;
  }
  .pri {
    font-size: 9px;
    font-weight: 700;
    padding: 1px 5px;
    border-radius: 3px;
    color: white;
    flex-shrink: 0;
    letter-spacing: 0.04em;
  }
  .pri-p0 { background: #d92d20; }
  .pri-p1 { background: #f79009; }
  .pri-p2 { background: #2e90fa; }
  .pri-p3 { background: var(--text-subtle); }

  /* Action toolbar at the bottom of the card. Lets the title row use
     the full card width (= fewer wrap-lines on narrow columns) by
     hosting the play / approve / split / add-subtask buttons here. */
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 4px;
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--border-subtle);
  }
  .icon-btn {
    background: transparent;
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    padding: 1px 6px;
    font-size: 12px;
    cursor: pointer;
    color: var(--text-secondary);
    flex-shrink: 0;
  }
  .icon-btn:hover {
    background: var(--bg-hover);
    border-color: var(--text-subtle);
  }
  .icon-btn.play {
    background: var(--success);
    border-color: var(--success);
    color: white;
  }
  .icon-btn.play:hover:not(:disabled) {
    background: #036a3e;
    border-color: #036a3e;
  }
  .icon-btn.approve {
    background: #a78bfa;
    border-color: #a78bfa;
    color: white;
  }
  .icon-btn.approve:hover:not(:disabled) {
    background: #8b5cf6;
    border-color: #8b5cf6;
  }
  .icon-btn:disabled {
    opacity: 0.5;
    cursor: wait;
  }

  .chip {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 3px;
    background: var(--bg-elevated);
    color: var(--text-secondary);
  }

  .tasks, .blockers {
    list-style: none;
    padding: 0;
    margin: 6px 0 0;
    font-size: 12px;
  }
  .tasks li, .blockers li {
    padding: 4px 0;
    border-top: 1px solid var(--border-subtle);
  }
  .tasks li.running { background: var(--success-bg); }
  .tasks li.claimed .task-title { color: var(--text-primary); font-weight: 500; }
  .task-line {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
  }
  .task-eta {
    font-size: 10px;
    color: var(--text-muted);
    white-space: nowrap;
    flex-shrink: 0;
  }
  .task-meta {
    color: var(--text-muted);
    font-size: 11px;
    display: block;
  }
  .blockers li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 6px;
    color: var(--warning);
  }
  .card-footer {
    margin-top: 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .card-progress {
    height: 6px;
    background: var(--border-default);
    border-radius: 3px;
    overflow: hidden;
  }
  .card-progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #2e90fa, var(--accent));
    transition: width 0.4s ease-out;
  }
  .card-stats {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--text-muted);
  }
  .dot { opacity: 0.5; }

  footer {
    display: flex;
    gap: 6px;
    margin-top: 8px;
  }
  .badge {
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 3px;
  }
  .badge.running { background: var(--success-bg); color: var(--success); }
  .badge.blocked { background: var(--warning-bg); color: var(--warning); }
</style>
