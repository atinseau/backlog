<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import { apiUrl, fetchOrchestratorState, pauseOrchestrator, stopOrchestrator } from "./api.js";
  import { t } from "./i18n.svelte.js";

  interface Props {
    open: boolean;
    workspaceId: string | null;
    onClose: () => void;
  }

  let { open, workspaceId, onClose }: Props = $props();

  // Fetched on mount + refreshed whenever an orchestrator.changed SSE
  // event lands. Drives the visibility / enabled state of the emergency
  // pause/stop buttons so we don't show controls that would 4xx.
  let orchestratorMode = $state<string | null>(null);
  async function refreshOrchestratorMode() {
    try {
      const state = await fetchOrchestratorState();
      orchestratorMode = state.mode;
    } catch {
      orchestratorMode = null;
    }
  }

  interface ChatTurn {
    role: "user" | "assistant";
    content: string;
    toolCalls?: Array<{
      name: string;
      status: "running" | "done" | "error" | "awaiting_confirmation";
      size?: number;
      error?: string;
      write?: boolean;
    }>;
  }
  interface UsageBucket {
    input: number;
    output: number;
    cacheRead: number;
    cacheCreation: number;
  }
  let history = $state<ChatTurn[]>([]);
  let input = $state("");
  let busy = $state(false);
  let error = $state<string | null>(null);
  let scrollEl = $state<HTMLDivElement | null>(null);
  let usage = $state<UsageBucket>({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0 });
  let actionBusy = $state<"pause" | "stop" | null>(null);

  // History is persisted per workspace so switching workspaces doesn't mix
  // conversations and a tab refresh keeps the thread you were on. Bounded
  // to the last 30 turns so localStorage stays small.
  const HISTORY_KEY_PREFIX = "backlog.chat.history.";
  const MAX_HISTORY = 30;

  function historyKey(id: string | null): string | null {
    return id ? HISTORY_KEY_PREFIX + id : null;
  }

  function loadHistory(id: string | null) {
    const key = historyKey(id);
    if (!key) {
      history = [];
      usage = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
      return;
    }
    try {
      const raw = localStorage.getItem(key);
      const parsed = raw ? JSON.parse(raw) : null;
      history = Array.isArray(parsed?.history) ? parsed.history : [];
      usage = parsed?.usage ?? { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
    } catch {
      history = [];
      usage = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
    }
  }

  function saveHistory() {
    const key = historyKey(workspaceId);
    if (!key) return;
    try {
      const trimmed = history.slice(-MAX_HISTORY);
      localStorage.setItem(key, JSON.stringify({ history: trimmed, usage }));
    } catch {
      // localStorage full or disabled — silently degrade
    }
  }

  // Live event feed: tail of the workspace's SSE bus, displayed at the
  // bottom of the drawer so the user can watch the orchestrator tick
  // without leaving the chat.
  interface LiveEvent {
    id: number;
    type: string;
    ts: string;
  }
  let events = $state<LiveEvent[]>([]);
  const MAX_EVENTS = 30;
  let nextEventId = 0;
  let source: EventSource | null = null;

  function pushEvent(type: string) {
    events = [
      { id: nextEventId++, type, ts: new Date().toLocaleTimeString("fr-FR") },
      ...events,
    ].slice(0, MAX_EVENTS);
  }

  function attachEventSource() {
    source?.close();
    source = new EventSource(apiUrl("/events"));
    const types = [
      "subtask.changed",
      "task.changed",
      "run.changed",
      "claim.changed",
      "orchestrator.changed",
    ];
    for (const type of types) {
      source.addEventListener(type, () => {
        pushEvent(type);
        if (type === "orchestrator.changed") void refreshOrchestratorMode();
      });
    }
  }

  onMount(() => {
    window.addEventListener("keydown", handleGlobalKey);
  });

  // Single source of truth for workspace-bound setup: this effect runs
  // once on mount with the initial workspaceId, and again every time it
  // changes (workspace switch). onMount can't safely do this work
  // because the prop may still be null at first paint while App resolves
  // the active workspace from localStorage.
  let lastWorkspaceId: string | null | undefined = undefined;
  $effect(() => {
    const id = workspaceId;
    if (id === lastWorkspaceId) return;
    const firstRun = lastWorkspaceId === undefined;
    lastWorkspaceId = id;
    if (!firstRun) events = [];
    loadHistory(id);
    attachEventSource();
    void refreshOrchestratorMode();
  });

  onDestroy(() => {
    source?.close();
    window.removeEventListener("keydown", handleGlobalKey);
  });

  function handleGlobalKey(e: KeyboardEvent) {
    if (open && e.key === "Escape" && !busy) {
      onClose();
    }
  }

  async function scrollToBottom() {
    await tick();
    if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    input = "";
    error = null;
    history = [...history, { role: "user", content: text }, { role: "assistant", content: "", toolCalls: [] }];
    busy = true;
    void scrollToBottom();

    const messagesForApi = history
      .slice(0, -1) // drop the empty placeholder we just added
      .map((turn) => ({ role: turn.role, content: turn.content }));

    try {
      const response = await fetch(apiUrl("/orchestrator/chat"), {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify({ messages: messagesForApi }),
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(detail?.detail ?? `HTTP ${response.status}`);
      }
      if (!response.body) throw new Error("Stream body missing");
      await consumeSseStream(response.body);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      // Strip the empty placeholder so the user can retry
      history = history.slice(0, -1);
    } finally {
      busy = false;
      saveHistory();
      void scrollToBottom();
    }
  }

  async function emergency(action: "pause" | "stop") {
    if (actionBusy) return;
    const label = action === "pause" ? t("chat.confirm_pause") : t("chat.confirm_stop");
    if (!window.confirm(label)) return;
    actionBusy = action;
    try {
      const fn = action === "pause" ? pauseOrchestrator : stopOrchestrator;
      const state = await fn();
      // Surface the action in the chat history so the user (and the agent
      // on subsequent turns) sees what just happened.
      history = [
        ...history,
        {
          role: "assistant",
          content: t(action === "pause" ? "chat.emergency_paused" : "chat.emergency_stopped", {
            mode: state.mode,
          }),
        },
      ];
      saveHistory();
      void scrollToBottom();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      actionBusy = null;
    }
  }

  // Minimal SSE parser. The hono streamSSE format we're consuming sends
  // standard "event:" + "data:" pairs separated by blank lines. We don't
  // need the full robustness of EventSource (no reconnect logic etc.)
  // since this is one short-lived stream per turn.
  async function consumeSseStream(body: ReadableStream<Uint8Array>) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx = buffer.indexOf("\n\n");
      while (idx >= 0) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        handleSseBlock(block);
        idx = buffer.indexOf("\n\n");
      }
    }
  }

  function handleSseBlock(block: string) {
    let event = "message";
    let data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data += line.slice(5).trim();
    }
    if (!data) return;
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return;
    }
    const last = history[history.length - 1];
    if (!last || last.role !== "assistant") return;
    if (event === "text") {
      last.content += String(payload.delta ?? "");
      history = [...history];
      void scrollToBottom();
    } else if (event === "tool_use") {
      last.toolCalls = [
        ...(last.toolCalls ?? []),
        { name: String(payload.name), status: "running", write: Boolean(payload.write) },
      ];
      history = [...history];
    } else if (event === "tool_result") {
      const list = last.toolCalls ?? [];
      // Match by name + first matching "running" entry (we don't expose ids
      // to the UI to keep it simple — there's never more than a couple in
      // flight at once).
      const idx = list.findIndex((c) => c.name === String(payload.name) && c.status === "running");
      if (idx >= 0) {
        const updated = { ...list[idx]! };
        if (payload.error) {
          updated.status = "error";
          updated.error = String(payload.error);
        } else if (payload.awaiting_confirmation) {
          updated.status = "awaiting_confirmation";
        } else {
          updated.status = "done";
        }
        if (typeof payload.size === "number") updated.size = payload.size;
        list[idx] = updated;
        last.toolCalls = list;
        history = [...history];
      }
    } else if (event === "done") {
      // Accumulate token usage across the whole conversation so the user
      // can see the running cost. The agent loop emits one done event per
      // user turn (after all tool roundtrips), so this fires once per
      // user message.
      const u = payload.usage as Record<string, number> | undefined;
      if (u) {
        usage = {
          input: usage.input + (u.input_tokens ?? 0),
          output: usage.output + (u.output_tokens ?? 0),
          cacheRead: usage.cacheRead + (u.cache_read_input_tokens ?? 0),
          cacheCreation: usage.cacheCreation + (u.cache_creation_input_tokens ?? 0),
        };
      }
    } else if (event === "error") {
      error = String(payload.message ?? "unknown error");
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function clearHistory() {
    history = [];
    usage = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
    error = null;
    saveHistory();
  }

  function fmt(n: number): string {
    if (n < 1000) return String(n);
    if (n < 1_000_000) return (n / 1000).toFixed(1) + "k";
    return (n / 1_000_000).toFixed(2) + "M";
  }
  const totalUsage = $derived(usage.input + usage.output + usage.cacheRead + usage.cacheCreation);
  const isLive = $derived(orchestratorMode === "running" || orchestratorMode === "paused");
</script>

{#if open}
  <aside class="drawer" aria-label={t("chat.title")}>
    <header>
      <h2>{t("chat.title")}</h2>
      <div class="actions">
        {#if isLive}
          <!-- Emergency pause/stop. The full surface (Play, settings) lives in
               the topbar OrchestratorControls — these are just the brakes
               for when something looks wrong and the user wants out fast. -->
          <button
            class="emergency"
            onclick={() => emergency("pause")}
            disabled={actionBusy !== null || orchestratorMode !== "running"}
            title={t("chat.action_pause")}
          >{actionBusy === "pause" ? "…" : "⏸"}</button>
          <button
            class="emergency stop"
            onclick={() => emergency("stop")}
            disabled={actionBusy !== null || orchestratorMode === "idle"}
            title={t("chat.action_stop")}
          >{actionBusy === "stop" ? "…" : "⏹"}</button>
        {/if}
        <button onclick={clearHistory} title={t("chat.clear")} disabled={history.length === 0 || busy}>↺</button>
        <button onclick={onClose} aria-label={t("chat.close")} title={t("chat.close_hint")}>✕</button>
      </div>
    </header>

    <div class="conversation" bind:this={scrollEl}>
      {#if history.length === 0}
        <p class="placeholder">{t("chat.intro")}</p>
      {/if}
      {#each history as turn, i (i)}
        <div class="turn turn-{turn.role}">
          <div class="bubble">
            {#if turn.toolCalls && turn.toolCalls.length > 0}
              <ul class="tools">
                {#each turn.toolCalls as call (call.name + i)}
                  <li class="tool tool-{call.status}" class:write={call.write}>
                    <span class="tool-icon">
                      {#if call.status === "running"}⋯
                      {:else if call.status === "error"}⚠
                      {:else if call.status === "awaiting_confirmation"}🔒
                      {:else}✓{/if}
                    </span>
                    <code>{call.name}</code>
                    {#if call.write && call.status === "done"}<span class="write-tag">{t("chat.executed")}</span>{/if}
                    {#if call.error}<span class="tool-err">{call.error}</span>{/if}
                  </li>
                {/each}
              </ul>
            {/if}
            <div class="text">{turn.content || (busy && i === history.length - 1 ? "…" : "")}</div>
          </div>
        </div>
      {/each}
      {#if error}
        <div class="error">{error}</div>
      {/if}
    </div>

    <form
      class="composer"
      onsubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <textarea
        rows="2"
        bind:value={input}
        onkeydown={handleKeydown}
        placeholder={t("chat.placeholder")}
        disabled={busy}
      ></textarea>
      <button type="submit" class="send" disabled={busy || input.trim().length === 0}>
        {busy ? "…" : "↑"}
      </button>
    </form>

    {#if totalUsage > 0}
      <div class="usage" title={t("chat.usage_hint")}>
        <span>↑ {fmt(usage.input)}</span>
        <span>↓ {fmt(usage.output)}</span>
        {#if usage.cacheRead > 0}<span class="cache">⚡ {fmt(usage.cacheRead)}</span>{/if}
      </div>
    {/if}

    <section class="feed" aria-label={t("chat.feed")}>
      <h3>{t("chat.feed")}</h3>
      {#if events.length === 0}
        <p class="muted">{t("chat.feed_empty")}</p>
      {:else}
        <ul>
          {#each events as ev (ev.id)}
            <li>
              <span class="ts">{ev.ts}</span>
              <code>{ev.type}</code>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  </aside>
{/if}

<style>
  .drawer {
    position: fixed;
    top: 0;
    right: 0;
    width: min(380px, 92vw);
    height: 100vh;
    background: white;
    border-left: 1px solid #e4e7ec;
    box-shadow: -4px 0 16px rgba(0, 0, 0, 0.08);
    z-index: 50;
    display: flex;
    flex-direction: column;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 14px;
    border-bottom: 1px solid #e4e7ec;
    background: white;
    flex-shrink: 0;
  }
  h2 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
  }
  .actions { display: flex; gap: 4px; }
  .actions button {
    background: #f2f4f7;
    border: 1px solid #d0d5dd;
    border-radius: 4px;
    padding: 2px 8px;
    cursor: pointer;
    font-size: 13px;
    color: #475467;
  }
  .actions button:hover:not(:disabled) { background: #e4e7ec; }
  .actions button:disabled { opacity: 0.4; cursor: not-allowed; }
  .actions button.emergency {
    background: #fef0c7;
    border-color: #f79009;
    color: #b54708;
  }
  .actions button.emergency:hover:not(:disabled) { background: #fdb022; color: white; }
  .actions button.emergency.stop {
    background: #fee4e2;
    border-color: #f04438;
    color: #b42318;
  }
  .actions button.emergency.stop:hover:not(:disabled) { background: #f04438; color: white; }

  .usage {
    flex-shrink: 0;
    display: flex;
    gap: 10px;
    padding: 4px 12px;
    border-top: 1px solid #e4e7ec;
    background: #fafafa;
    font-size: 10px;
    color: #667085;
    font-variant-numeric: tabular-nums;
  }
  .usage .cache { color: #027a48; }

  .conversation {
    flex: 1;
    overflow-y: auto;
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    font-size: 13px;
  }
  .placeholder { color: #98a2b3; font-style: italic; margin: 8px 0 0; line-height: 1.45; }
  .turn { display: flex; }
  .turn-user { justify-content: flex-end; }
  .bubble {
    max-width: 85%;
    padding: 8px 10px;
    border-radius: 8px;
    line-height: 1.4;
    white-space: pre-wrap;
    word-wrap: break-word;
  }
  .turn-user .bubble { background: #2e90fa; color: white; border-top-right-radius: 2px; }
  .turn-assistant .bubble { background: #f2f4f7; color: #1d2939; border-top-left-radius: 2px; }
  .text { white-space: pre-wrap; }

  .tools {
    list-style: none;
    padding: 0;
    margin: 0 0 6px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    font-size: 11px;
  }
  .tool {
    display: flex;
    gap: 6px;
    align-items: center;
    padding: 2px 6px;
    background: rgba(255, 255, 255, 0.6);
    border-radius: 3px;
  }
  .tool code {
    font-family: ui-monospace, monospace;
    color: #475467;
  }
  .tool-icon { font-weight: 600; }
  .tool-running .tool-icon { color: #f79009; }
  .tool-done .tool-icon { color: #027a48; }
  .tool-error .tool-icon { color: #b42318; }
  .tool-awaiting_confirmation .tool-icon { color: #b54708; }
  .tool.write {
    border-left: 2px solid #d92d20;
    padding-left: 4px;
  }
  .tool.write.tool-done {
    border-left-color: #027a48;
    background: #d1fadf;
  }
  .write-tag {
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #027a48;
    font-weight: 600;
  }
  .tool-err { color: #b42318; font-size: 10px; }

  .error {
    background: #fee4e2;
    color: #b42318;
    padding: 8px 10px;
    border-radius: 4px;
    font-size: 12px;
    margin-top: 6px;
  }

  .composer {
    display: flex;
    gap: 6px;
    padding: 10px 12px;
    border-top: 1px solid #e4e7ec;
    background: #fafafa;
    flex-shrink: 0;
  }
  .composer textarea {
    flex: 1;
    border: 1px solid #d0d5dd;
    border-radius: 6px;
    padding: 6px 8px;
    font-family: inherit;
    font-size: 13px;
    resize: none;
    line-height: 1.4;
  }
  .composer textarea:focus { outline: 2px solid #2e90fa; outline-offset: -1px; border-color: #2e90fa; }
  .composer textarea:disabled { opacity: 0.6; }
  .send {
    background: #027a48;
    color: white;
    border: none;
    border-radius: 6px;
    padding: 0 14px;
    cursor: pointer;
    font-size: 16px;
    font-weight: 600;
  }
  .send:hover:not(:disabled) { background: #036a3e; }
  .send:disabled { background: #98a2b3; cursor: not-allowed; }

  .feed {
    flex-shrink: 0;
    max-height: 30vh;
    border-top: 1px solid #e4e7ec;
    padding: 8px 12px 10px;
    overflow-y: auto;
    background: #fafafa;
  }
  .feed h3 {
    margin: 0 0 6px;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #667085;
    font-weight: 600;
  }
  .feed ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 11px;
  }
  .feed li { display: flex; gap: 6px; align-items: baseline; }
  .feed .ts { color: #98a2b3; font-variant-numeric: tabular-nums; }
  .feed code { color: #475467; font-family: ui-monospace, monospace; }
  .muted { color: #98a2b3; font-size: 11px; margin: 0; font-style: italic; }
</style>
