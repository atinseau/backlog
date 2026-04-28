<script lang="ts">
  import RetryBadge from "./RetryBadge.svelte";
  import { t } from "./i18n.svelte.js";
  import { formatDuration, formatRemaining, useTimer } from "./timer.svelte.js";
  import type { SubTaskCard, TaskCard } from "./types.js";
  import { onDestroy } from "svelte";

  interface Props {
    card: TaskCard;
    onSplit?: (card: TaskCard) => void;
    onAddTask?: (card: TaskCard) => void;
    onOpen?: (card: TaskCard) => void;
    onPlay?: (card: TaskCard) => Promise<void> | void;
  }

  let { card, onSplit, onAddTask, onOpen, onPlay }: Props = $props();

  const timer = useTimer();
  onDestroy(() => timer.release());

  const priorityClass = $derived(`pri pri-${card.priority.toLowerCase()}`);
  const blockedCount = $derived(card.blocked_by_claims.length);
  const runningCount = $derived(card.tasks.filter((t) => t.active_run !== null).length);
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

  function progressBarColor(task: SubTaskCard): string {
    if (task.status === "completed") return "#12b76a";
    if (task.status === "blocked") return "#f04438";
    if (task.status === "review") return "#9e77ed";
    if (task.status === "running") return "#12b76a";
    if (task.status === "waiting") return "#f79009";
    return "#98a2b3";
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
<article
  class="card"
  class:clickable={Boolean(onOpen)}
  onpointerdown={handlePointerDown}
  onclick={handleClick}
  onkeydown={handleKeydown}
  role={onOpen ? "button" : undefined}
  tabindex={onOpen ? 0 : undefined}
>
  <header>
    <span class={priorityClass}>{card.priority}</span>
    <h3>{card.title}</h3>
    {#if canPlay}
      <button
        class="icon-btn play"
        onclick={handlePlayClick}
        disabled={starting}
        aria-label={t("card.play")}
        title={t("card.play")}
      >{starting ? "…" : "▶"}</button>
    {/if}
    {#if onSplit && card.tasks.length === 0}
      <button class="icon-btn" onclick={handleSplitClick} aria-label={t("card.split")} title={t("card.split")}>✂</button>
    {/if}
    {#if onAddTask}
      <button class="icon-btn" onclick={handleAddTaskClick} aria-label={t("card.add_subtask")} title={t("card.add_subtask")}>+</button>
    {/if}
  </header>

  {#if card.repo_targets.length > 0}
    <div class="chips">
      {#each card.repo_targets as repo (repo)}
        <span class="chip repo">{repo}</span>
      {/each}
    </div>
  {/if}

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
          <div class="progress-bar" aria-label="progress" style:--fill={progressBarColor(task)}>
            <div class="progress-fill" style:width="{task.progress_percent}%"></div>
          </div>
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
</article>

<style>
  .card {
    background: white;
    border-radius: 6px;
    padding: 10px 12px;
    margin-bottom: 8px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
    border-left: 3px solid #ccc;
    cursor: grab;
    transition: box-shadow 120ms ease, transform 120ms ease;
  }
  .card.clickable:hover {
    box-shadow: 0 2px 6px rgba(16, 24, 40, 0.12);
    transform: translateY(-1px);
  }
  .card.clickable:focus-visible {
    outline: 2px solid #1570ef;
    outline-offset: 2px;
  }
  header {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin-bottom: 6px;
  }
  h3 {
    margin: 0;
    font-size: 14px;
    line-height: 1.3;
    flex: 1;
  }
  .pri {
    font-size: 11px;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 3px;
    color: white;
    flex-shrink: 0;
  }
  .pri-p0 { background: #d92d20; }
  .pri-p1 { background: #f79009; }
  .pri-p2 { background: #2e90fa; }
  .pri-p3 { background: #98a2b3; }

  .icon-btn {
    background: transparent;
    border: 1px solid #d0d5dd;
    border-radius: 4px;
    padding: 1px 6px;
    font-size: 12px;
    cursor: pointer;
    color: #475467;
    flex-shrink: 0;
  }
  .icon-btn:hover {
    background: #f2f4f7;
    border-color: #98a2b3;
  }
  .icon-btn.play {
    background: #027a48;
    border-color: #027a48;
    color: white;
  }
  .icon-btn.play:hover:not(:disabled) {
    background: #036a3e;
    border-color: #036a3e;
  }
  .icon-btn:disabled {
    opacity: 0.5;
    cursor: wait;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 6px;
  }
  .chip {
    font-size: 11px;
    padding: 2px 6px;
    border-radius: 3px;
    background: #f2f4f7;
    color: #344054;
  }

  .tasks, .blockers {
    list-style: none;
    padding: 0;
    margin: 6px 0 0;
    font-size: 12px;
  }
  .tasks li, .blockers li {
    padding: 4px 0;
    border-top: 1px solid #f0f0f0;
  }
  .tasks li.running { background: #ecfdf3; }
  .tasks li.claimed .task-title { color: #1d2939; font-weight: 500; }
  .task-line {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
  }
  .task-eta {
    font-size: 10px;
    color: #667085;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .task-meta {
    color: #667085;
    font-size: 11px;
    display: block;
  }
  .progress-bar {
    height: 4px;
    background: #e4e7ec;
    border-radius: 2px;
    overflow: hidden;
    margin-top: 4px;
  }
  .progress-fill {
    height: 100%;
    background: var(--fill, #98a2b3);
    transition: width 0.4s ease-out;
  }
  .blockers li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 6px;
    color: #b54708;
  }
  .card-footer {
    margin-top: 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .card-progress {
    height: 6px;
    background: #e4e7ec;
    border-radius: 3px;
    overflow: hidden;
  }
  .card-progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #2e90fa, #1570ef);
    transition: width 0.4s ease-out;
  }
  .card-stats {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: #667085;
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
  .badge.running { background: #d1fadf; color: #027a48; }
  .badge.blocked { background: #fef0c7; color: #b54708; }
</style>
