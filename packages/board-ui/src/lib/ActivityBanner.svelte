<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import { apiUrl } from "./api.js";
  import { t } from "./i18n.svelte.js";

  interface Props {
    workspaceId: string | null;
  }

  let { workspaceId }: Props = $props();

  // Open/closed state persisted in localStorage. Mounted bar is always
  // visible (collapsed) so the user can find the toggle even on a
  // narrow viewport — only the body folds away.
  const STORAGE_KEY = "backlog.activity.open";
  let open = $state(typeof localStorage !== "undefined" && localStorage.getItem(STORAGE_KEY) === "1");
  function toggle() {
    open = !open;
    if (typeof localStorage !== "undefined") {
      if (open) localStorage.setItem(STORAGE_KEY, "1");
      else localStorage.removeItem(STORAGE_KEY);
    }
    if (open) {
      unread = 0;
      void scrollToBottom();
    }
  }

  interface ActivityEvent {
    id: number;
    kind: "activity" | "bus";
    ts: string;
    runId?: string;
    type: string;
    message?: string;
  }
  let events = $state<ActivityEvent[]>([]);
  let unread = $state(0);
  const MAX_EVENTS = 200;
  let nextId = 0;
  let busSource: EventSource | null = null;
  let activitySource: EventSource | null = null;
  let scrollEl = $state<HTMLDivElement | null>(null);
  let stickToBottom = true;

  async function scrollToBottom() {
    await tick();
    if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
  }

  function pushEvent(ev: Omit<ActivityEvent, "id">) {
    events = [...events, { id: nextId++, ...ev }].slice(-MAX_EVENTS);
    if (!open) unread = Math.min(unread + 1, 99);
    if (open && stickToBottom) void scrollToBottom();
  }

  function attach() {
    busSource?.close();
    activitySource?.close();

    busSource = new EventSource(apiUrl("/events"));
    const busTypes = [
      "subtask.changed",
      "task.changed",
      "run.changed",
      "claim.changed",
      "orchestrator.changed",
    ];
    for (const type of busTypes) {
      busSource.addEventListener(type, () => {
        pushEvent({ kind: "bus", type, ts: new Date().toISOString() });
      });
    }

    activitySource = new EventSource(apiUrl("/activity/stream"));
    activitySource.addEventListener("activity", (raw) => {
      try {
        const data = JSON.parse((raw as MessageEvent).data) as Record<string, unknown>;
        pushEvent({
          kind: "activity",
          ts: typeof data.ts === "string" ? data.ts : new Date().toISOString(),
          runId: typeof data.run_id === "string" ? data.run_id : undefined,
          type: typeof data.type === "string" ? data.type : "raw",
          message: typeof data.message === "string" ? data.message : undefined,
        });
      } catch {
        // ignore malformed
      }
    });
  }

  function handleScroll() {
    if (!scrollEl) return;
    // Keep auto-tail unless the user scrolled away from the bottom
    // (within 20px slack to avoid flapping on subpixel rounding).
    const distanceFromBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
    stickToBottom = distanceFromBottom < 20;
  }

  function clearAll() {
    events = [];
    unread = 0;
  }

  // Workspace switch: re-attach (apiUrl now points to a different
  // workspace) and clear the previous workspace's events from the
  // visible list — they'd be misleading since they reference run ids
  // that aren't in this workspace.
  let lastWorkspaceId: string | null | undefined = undefined;
  $effect(() => {
    const id = workspaceId;
    if (id === lastWorkspaceId) return;
    lastWorkspaceId = id;
    events = [];
    unread = 0;
    attach();
  });

  onMount(() => {
    if (open) void scrollToBottom();
  });

  onDestroy(() => {
    busSource?.close();
    activitySource?.close();
  });
</script>

<div class="bar" class:open>
  <button
    class="toggle"
    onclick={toggle}
    aria-expanded={open}
    title={open ? t("activity.collapse") : t("activity.expand")}
  >
    <span class="chevron">{open ? "▾" : "▴"}</span>
    <span class="label">{t("activity.title")}</span>
    {#if !open && unread > 0}
      <span class="badge">{unread}</span>
    {/if}
    {#if open}
      <span class="count">{events.length}</span>
    {/if}
  </button>
  {#if open}
    <div class="actions">
      <button onclick={clearAll} disabled={events.length === 0} title={t("activity.clear")}>↺</button>
    </div>
  {/if}
</div>

{#if open}
  <section class="panel" aria-label={t("activity.title")}>
    <div class="scroll" bind:this={scrollEl} onscroll={handleScroll}>
      {#if events.length === 0}
        <p class="muted">{t("activity.empty")}</p>
      {:else}
        <ul>
          {#each events as ev (ev.id)}
            <li class="evt evt-{ev.kind}">
              <span class="ts">{new Date(ev.ts).toLocaleTimeString("fr-FR")}</span>
              {#if ev.runId}<span class="run-pill">{ev.runId.replace(/^RUN-/, "").slice(0, 6)}</span>{/if}
              <code class="type">{ev.type}</code>
              {#if ev.message}<span class="msg">{ev.message}</span>{/if}
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </section>
{/if}

<style>
  .bar {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    height: 26px;
    background: #1d2939;
    color: #e4e7ec;
    border-top: 1px solid #344054;
    display: flex;
    align-items: stretch;
    z-index: 30;
    font-size: 11px;
  }
  .bar.open {
    bottom: 280px;
  }
  .toggle {
    background: transparent;
    border: none;
    color: inherit;
    padding: 0 12px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font: inherit;
    font-size: 11px;
    flex: 1;
    text-align: left;
    justify-content: flex-start;
  }
  .toggle:hover { background: #344054; }
  .chevron { font-size: 10px; color: #98a2b3; }
  .label { font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
  .count {
    color: #98a2b3;
    font-variant-numeric: tabular-nums;
    margin-left: 4px;
  }
  .badge {
    background: #f04438;
    color: white;
    border-radius: 10px;
    padding: 0 6px;
    font-size: 10px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .actions {
    display: flex;
    align-items: center;
    padding-right: 8px;
    gap: 4px;
  }
  .actions button {
    background: transparent;
    border: 1px solid #475467;
    color: #98a2b3;
    border-radius: 3px;
    padding: 1px 8px;
    cursor: pointer;
    font-size: 12px;
  }
  .actions button:hover:not(:disabled) {
    background: #344054;
    color: white;
  }
  .actions button:disabled { opacity: 0.4; cursor: not-allowed; }

  .panel {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    height: 280px;
    background: #0c111d;
    color: #d0d5dd;
    border-top: 1px solid #344054;
    z-index: 29;
    display: flex;
    flex-direction: column;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px;
  }
  .scroll {
    flex: 1;
    overflow-y: auto;
    padding: 8px 12px;
  }
  .muted { color: #667085; font-style: italic; margin: 0; padding: 16px 0; text-align: center; }
  ul { list-style: none; margin: 0; padding: 0; }
  .evt {
    display: flex;
    gap: 8px;
    align-items: baseline;
    padding: 1px 0;
    border-left: 2px solid transparent;
    padding-left: 6px;
  }
  .evt-bus { opacity: 0.55; }
  .evt-bus .type { color: #667085; }
  .evt-activity { border-left-color: #027a48; }
  .evt-activity .type { color: #6ce9a6; font-weight: 600; }
  .ts { color: #667085; font-variant-numeric: tabular-nums; flex-shrink: 0; }
  .run-pill {
    background: #1570ef;
    color: white;
    padding: 0 5px;
    border-radius: 2px;
    font-size: 10px;
    flex-shrink: 0;
    line-height: 1.4;
  }
  .type { flex-shrink: 0; }
  .msg {
    color: #d0d5dd;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }

  @media (max-width: 600px) {
    .bar.open { bottom: 200px; }
    .panel { height: 200px; }
  }
</style>
