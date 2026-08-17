<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import { apiUrl } from "./api.js";
  import { t } from "./i18n.svelte.js";

  interface Props {
    projectId: string | null;
    onOpenDiff?: (runId: string, file: string) => void;
    // When true (used by the BottomPanel host) the component drops its
    // fixed-position toggle bar and just renders the events list flowing
    // into whatever container it's mounted in. The host is responsible
    // for the tab chrome.
    embedded?: boolean;
  }

  let { projectId, onOpenDiff, embedded = false }: Props = $props();

  // Pull a file path out of the activity event message when one is
  // present. Tool summaries follow the shape "Read foo/bar.rb" /
  // "Edit app/views/x.erb" / "Write config/locales/es.yml" — match the
  // first whitespace-separated token that looks like a repository-relative
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
    onOpenDiff(runId, normalizeWorktreeFile(file));
  }

  function normalizeWorktreeFile(file: string): string {
    const m = /\/\.backlog\/worktrees\/[^/]+\/run_\d+\/(.+)$/.exec(file);
    return m?.[1] ?? file;
  }

  function formatRunId(runId: string): string {
    return runId.replace(/^RUN-/, "");
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
    runId?: string | undefined;
    agentId?: string | undefined;
    type: string;
    message?: string | undefined;
    provider?: string | undefined;
    model?: string | undefined;
    inputTokens?: number | undefined;
    outputTokens?: number | undefined;
    cacheReadInputTokens?: number | undefined;
    cacheCreationInputTokens?: number | undefined;
  }
  let events = $state<ActivityEvent[]>([]);
  let unread = $state(0);
  const MAX_EVENTS = 200;
  let nextId = 0;
  let busSource: EventSource | null = null;
  let activitySource: EventSource | null = null;
  let scrollEl = $state<HTMLDivElement | null>(null);
  let stickToBottom = true;

  function selectAllLogText() {
    if (!scrollEl) return;
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(scrollEl);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function handleKeydown(event: KeyboardEvent) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
      event.preventDefault();
      selectAllLogText();
    }
  }

  function focusLog() {
    scrollEl?.focus({ preventScroll: true });
  }

  function numberField(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  }

  function formatTokens(value: number): string {
    return new Intl.NumberFormat().format(value);
  }

  function usageMessage(ev: ActivityEvent): string | undefined {
    if (ev.message) return ev.message;
    if (ev.type !== "usage") return ev.message;
    const input = ev.inputTokens ?? 0;
    const output = ev.outputTokens ?? 0;
    const cacheRead = ev.cacheReadInputTokens ?? 0;
    const cacheWrite = ev.cacheCreationInputTokens ?? 0;
    const total = input + output + cacheRead + cacheWrite;
    const model = [ev.provider, ev.model].filter(Boolean).join(" ");
    const bits = [
      model || "Usage",
      `${formatTokens(total)} tokens`,
      `input ${formatTokens(input)}`,
      `output ${formatTokens(output)}`,
    ];
    if (cacheRead > 0) bits.push(`cache read ${formatTokens(cacheRead)}`);
    if (cacheWrite > 0) bits.push(`cache write ${formatTokens(cacheWrite)}`);
    return bits.join(" · ");
  }

  function displayMessage(ev: ActivityEvent): string | undefined {
    return usageMessage(ev);
  }

  function shouldHideEvent(ev: Omit<ActivityEvent, "id">): boolean {
    if (ev.type === "workspace.no_git") return true;
    if (ev.type === "run.commit_skipped" && /not a Git repository|Commit disabled/i.test(ev.message ?? "")) return true;
    return false;
  }

  async function scrollToBottom() {
    await tick();
    if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
  }

  function pushEvent(ev: Omit<ActivityEvent, "id">) {
    if (ev.type === "raw" && ev.message && /^[{}\[\],]+$/.test(ev.message.trim())) {
      return;
    }
    if (shouldHideEvent(ev)) return;
    events = [...events, { id: nextId++, ...ev }].slice(-MAX_EVENTS);
    if (!open) unread = Math.min(unread + 1, 99);
    if (open && stickToBottom) void scrollToBottom();
  }

  function attach() {
    busSource?.close();
    activitySource?.close();

    // Bus events drove the activity log to flood with naked
    // "claim.changed" / "subtask.changed" lines that carried no
    // actionable info — they're a hint to the BOARD that something
    // changed, not user-visible activity. The activity SSE below
    // already surfaces every meaningful event with run_id + message
    // (executor.start, agent.bash, run.committed, etc.) so we drop
    // the bus subscription from this feed. App.svelte still listens
    // to /events for board-refresh purposes.
    busSource?.close();
    busSource = null;

    activitySource = new EventSource(apiUrl("/activity/stream"));
    activitySource.addEventListener("activity", (raw) => {
      try {
        const data = JSON.parse((raw as MessageEvent).data) as Record<string, unknown>;
        pushEvent({
          kind: "activity",
          ts: typeof data.ts === "string" ? data.ts : new Date().toISOString(),
          runId: typeof data.run_id === "string" ? data.run_id : undefined,
          agentId: typeof data.agent_id === "string" ? data.agent_id : undefined,
          type: typeof data.type === "string" ? data.type : "raw",
          message: typeof data.message === "string" ? data.message : undefined,
          provider: typeof data.provider === "string" ? data.provider : undefined,
          model: typeof data.model === "string" ? data.model : undefined,
          inputTokens: numberField(data.input_tokens),
          outputTokens: numberField(data.output_tokens),
          cacheReadInputTokens: numberField(data.cache_read_input_tokens),
          cacheCreationInputTokens: numberField(data.cache_creation_input_tokens),
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

  // Project switch: re-attach (apiUrl now points to a different
  // project) and clear the previous project's events from the
  // visible list — they'd be misleading since they reference run ids
  // that aren't in this project.
  let lastProjectId: string | null | undefined = undefined;
  $effect(() => {
    const id = projectId;
    if (id === lastProjectId) return;
    lastProjectId = id;
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
    <div
      class="scroll"
      bind:this={scrollEl}
      onscroll={handleScroll}
      onkeydown={handleKeydown}
      onpointerdown={focusLog}
      tabindex="0"
      role="textbox"
      aria-readonly="true"
      aria-multiline="true"
    >
      {#if events.length === 0}
        <p class="muted">{t("activity.empty")}</p>
      {:else}
        <ul>
          {#each events as ev (ev.id)}
            {@const file = isFileEvent(ev.type) ? extractFile(ev.message) : null}
            {@const msg = displayMessage(ev)}
            <li class="evt evt-{ev.kind}">
              <span class="ts">{new Date(ev.ts).toLocaleTimeString("fr-FR")}</span>
              {#if ev.runId}<span class="run-pill">{formatRunId(ev.runId)}</span>{/if}
              {#if ev.agentId}<span class="agent-pill">{ev.agentId}</span>{/if}
              <code class="type">{ev.type}</code>
              {#if msg}
                {#if file && onOpenDiff && ev.runId}
                  <span class="msg">
                    <button class="file-link" onclick={() => clickFile(ev.runId, file)} title={file}>{normalizeWorktreeFile(file)}</button>
                  </span>
                {:else}
                  <span class="msg">{msg}</span>
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
    /* Dimmed console ink. The document greys (--text-muted &co) are
       tuned for --bg-surface: on --console-bg the light theme's
       --text-muted only reaches 3.60:1. Deriving the secondary ink from
       the console's own pair keeps it ~7:1 in BOTH themes without
       lightening the surface ("la règle du sombre-machine"). */
    --console-meta: color-mix(in srgb, var(--console-text) 72%, var(--console-bg));
    /* Same reasoning for the green event label: --success is tuned to
       carry text on a PALE surface, so on --console-bg the light theme
       only reaches 3.48:1. Pulling it toward the console's own ink
       keeps it unmistakably green at 5.57:1 light / 12.08:1 dark. */
    --console-accent: color-mix(in srgb, var(--success) 65%, var(--console-text));
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
  .chevron { font-size: 11px; color: var(--text-subtle); }
  .label { font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
  .count {
    color: var(--console-meta);
    font-variant-numeric: tabular-nums;
    margin-left: 4px;
  }
  .badge {
    background: var(--danger-solid);
    color: var(--text-on-solid);
    border-radius: 999px;
    padding: 0 6px;
    font-size: 11px;
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
    /* WCAG 2.5.8 floor — 24px, 28px under a coarse pointer. */
    min-width: var(--tap-size);
    min-height: var(--tap-size);
  }
  .actions button:hover:not(:disabled) {
    background: var(--console-line);
    color: var(--text-on-fill);
  }
  .actions button:disabled { opacity: 0.4; cursor: not-allowed; }
  /* Pointer capability, not width — the bar has to be tall enough to
     host a 28px target once --tap-size widens. */
  @media (pointer: coarse) {
    .bar { height: 32px; }
  }

  .panel {
    /* See .bar — same derived secondary console ink. */
    --console-meta: color-mix(in srgb, var(--console-text) 72%, var(--console-bg));
    /* Same reasoning for the green event label: --success is tuned to
       carry text on a PALE surface, so on --console-bg the light theme
       only reaches 3.48:1. Pulling it toward the console's own ink
       keeps it unmistakably green at 5.57:1 light / 12.08:1 dark. */
    --console-accent: color-mix(in srgb, var(--success) 65%, var(--console-text));
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
    /* DESIGN.md, "La console" : mono 12px, dark in both themes. */
    font-size: 12px;
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
    overflow: auto;
    padding: 8px 12px;
    user-select: text;
    -webkit-user-select: text;
    outline: none;
  }
  /* The log is a focusable region (tabindex=0, role=textbox): killing
     the UA ring is only allowed with a real replacement. Inset offset
     because the region is flush with the panel edges. */
  .scroll:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .muted { color: var(--console-meta); font-style: italic; margin: 0; padding: 16px 0; text-align: center; }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    min-width: max-content;
  }
  .evt {
    display: flex;
    flex-wrap: nowrap;
    gap: 8px;
    align-items: baseline;
    padding: 1px 0;
    /* No coloured left rail: DESIGN.md reserves the 3px rail for the
       card priority marker, and since the bus feed was dropped every
       line here is an "activity" line — a rail on all of them carried
       no information at all. The green .type already says it. */
    padding-left: 8px;
    white-space: nowrap;
  }
  .evt-bus { opacity: 0.55; }
  .evt-bus .type { color: var(--console-meta); }
  .evt-activity .type { color: var(--console-accent); font-weight: 600; }
  .ts { color: var(--console-meta); font-variant-numeric: tabular-nums; flex-shrink: 0; }
  .run-pill {
    background: var(--accent);
    color: var(--accent-on);
    padding: 0 5px;
    border-radius: 3px;
    font-size: 11px;
    flex-shrink: 0;
    line-height: 1.4;
  }
  .agent-pill {
    /* --bg-hover is a document surface: in light mode it painted
       a near-white plate behind --console-text (1.16:1, unreadable).
       The console owns its own step above the background. */
    background: var(--console-line);
    border: 1px solid var(--console-border);
    color: var(--console-text);
    padding: 0 5px;
    border-radius: 3px;
    font-size: 11px;
    flex-shrink: 0;
    line-height: 1.4;
    max-width: 150px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .type { flex-shrink: 0; }
  .msg {
    color: var(--console-text);
    overflow: visible;
    text-overflow: clip;
    white-space: nowrap;
    flex: 0 0 auto;
    min-width: max-content;
  }
  .file-link {
    background: transparent;
    border: none;
    /* --accent-text is the text grade for PALE backgrounds; on
       --console-bg it only reaches 3.17:1. The -solid family is the
       bright mid-tone meant for dark fills (5.81:1 / 7.97:1). */
    color: var(--accent-solid);
    text-decoration: underline;
    cursor: pointer;
    font: inherit;
    padding: 0;
    user-select: text;
    -webkit-user-select: text;
  }
  .file-link:hover { color: var(--accent-solid); }

  /* BP_NARROW — see src/lib/shell/breakpoints.ts */
  @media (max-width: 640px) {
    .bar.open { bottom: 200px; }
    .panel { height: 200px; }
  }
</style>
