<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import { apiUrl } from "./api.js";
  import { t } from "./i18n.svelte.js";

  interface Props {
    workspaceId: string | null;
    onOpenDiff?: (runId: string, file: string) => void;
    // When true (used by the BottomPanel host) the component drops its
    // fixed-position toggle bar and just renders the events list flowing
    // into whatever container it's mounted in. The host is responsible
    // for the tab chrome.
    embedded?: boolean;
  }

  let { workspaceId, onOpenDiff, embedded = false }: Props = $props();

  // Pull a file path out of the activity event message when one is
  // present. Tool summaries follow the shape "Read foo/bar.rb" /
  // "Edit app/views/x.erb" / "Write config/locales/es.yml" — match the
  // first whitespace-separated token that looks like a repo-relative
  // file path. Returns null when nothing usable is found, in which
  // case the line stays plain text.
  function extractFile(message: string | undefined): string | null {
    if (!message) return null;
    // "Read app/views/foo.erb" → "app/views/foo.erb"
    // "Edit app/views/coming_soon.html.erb" → "app/views/coming_soon.html.erb"
    const m = /(?:^|\s)([\w./@\-]+\.[\w]+)/.exec(message);
    if (!m) return null;
    const candidate = m[1]!;
    // Reject things that look like flag tokens / numeric versions
    if (candidate.startsWith("-")) return null;
    if (/^\d/.test(candidate)) return null;
    return candidate;
  }

  function isFileEvent(type: string): boolean {
    return (
      type === "agent.read" ||
      type === "agent.edit" ||
      type === "agent.write" ||
      type === "agent.fs"
    );
  }

  function clickFile(runId: string | undefined, file: string) {
    if (!runId || !onOpenDiff) return;
    onOpenDiff(runId, file);
  }

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

{#if !embedded}
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
{/if}

{#if open || embedded}
  <section class="panel" class:embedded aria-label={t("activity.title")}>
    <div class="scroll" bind:this={scrollEl} onscroll={handleScroll}>
      {#if events.length === 0}
        <p class="muted">{t("activity.empty")}</p>
      {:else}
        <ul>
          {#each events as ev (ev.id)}
            {@const file = isFileEvent(ev.type) ? extractFile(ev.message) : null}
            <li class="evt evt-{ev.kind}">
              <span class="ts">{new Date(ev.ts).toLocaleTimeString("fr-FR")}</span>
              {#if ev.runId}<span class="run-pill">{ev.runId.replace(/^RUN-/, "").slice(0, 6)}</span>{/if}
              <code class="type">{ev.type}</code>
              {#if ev.message}
                {#if file && onOpenDiff && ev.runId}
                  <span class="msg">
                    <button class="file-link" onclick={() => clickFile(ev.runId, file)} title={file}>{file}</button>
                  </span>
                {:else}
                  <span class="msg">{ev.message}</span>
                {/if}
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </section>
{/if}

<style>
  /* The activity surface intentionally uses the console palette
     (kept dark in both light + dark modes) so it reads as a terminal
     log, distinct from the document chrome. */
  .bar {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    height: 26px;
    background: var(--console-bg);
    color: var(--console-text);
    border-top: 1px solid var(--console-border);
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
  .toggle:hover { background: var(--console-line); }
  .chevron { font-size: 10px; color: var(--text-subtle); }
  .label { font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
  .count {
    color: var(--text-subtle);
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
    border: 1px solid var(--console-border);
    color: var(--console-text);
    border-radius: 3px;
    padding: 1px 8px;
    cursor: pointer;
    font-size: 12px;
  }
  .actions button:hover:not(:disabled) {
    background: var(--console-line);
    color: white;
  }
  .actions button:disabled { opacity: 0.4; cursor: not-allowed; }

  .panel {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    height: 280px;
    background: var(--console-bg);
    color: var(--console-text);
    border-top: 1px solid var(--console-border);
    z-index: 29;
    display: flex;
    flex-direction: column;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px;
  }
  /* Embedded into the BottomPanel host: drop the fixed positioning,
     fill the parent container, and let the host handle the chrome. */
  .panel.embedded {
    position: relative;
    height: 100%;
    border-top: none;
    background: var(--console-bg);
  }
  .scroll {
    flex: 1;
    overflow-y: auto;
    padding: 8px 12px;
  }
  .muted { color: var(--text-muted); font-style: italic; margin: 0; padding: 16px 0; text-align: center; }
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
  .evt-bus .type { color: var(--text-muted); }
  .evt-activity { border-left-color: var(--success); }
  .evt-activity .type { color: var(--success); font-weight: 600; }
  .ts { color: var(--text-muted); font-variant-numeric: tabular-nums; flex-shrink: 0; }
  .run-pill {
    background: var(--accent);
    color: white;
    padding: 0 5px;
    border-radius: 2px;
    font-size: 10px;
    flex-shrink: 0;
    line-height: 1.4;
  }
  .type { flex-shrink: 0; }
  .msg {
    color: var(--console-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }
  .file-link {
    background: transparent;
    border: none;
    color: var(--accent-text);
    text-decoration: underline;
    cursor: pointer;
    font: inherit;
    padding: 0;
  }
  .file-link:hover { color: var(--accent-text); }

  @media (max-width: 600px) {
    .bar.open { bottom: 200px; }
    .panel { height: 200px; }
  }
</style>
