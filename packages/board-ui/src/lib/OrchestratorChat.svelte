<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import Composer from "./chat/Composer.svelte";
  import ConversationList from "./chat/ConversationList.svelte";
  import Icon from "./chat/Icon.svelte";
  import Message from "./chat/Message.svelte";
  import {
    chatConversations,
    chatError,
    chatSearch,
    chatStatus,
    currentConversation,
    editAndResend,
    isSending,
    loadChat,
    openConversation,
    regenerate,
    removeConversation,
    resetContext,
    sendMessage,
    setChatSearch,
    setConversationModel,
    startConversation,
    stopStreaming,
    streamingTurn,
    visibleMessages,
  } from "./chat/chat-state.svelte.js";
  import { apiUrl, pauseOrchestrator, stopOrchestrator } from "./api.js";
  import { loadProviders, modelsForProvider } from "./providers.svelte.js";
  import { t } from "./i18n.svelte.js";

  interface Props {
    open: boolean;
    projectId: string | null;
    onClose: () => void;
    /** Embedded in the BottomPanel: the host owns the chrome and the height. */
    embedded?: boolean;
  }

  let { open, projectId, onClose, embedded = false }: Props = $props();

  let scrollEl = $state<HTMLDivElement | null>(null);
  let showHistory = $state(false);
  let orchestratorMode = $state<string | null>(null);
  let actionBusy = $state<"pause" | "stop" | null>(null);
  let bus: EventSource | null = null;

  const conversation = $derived(currentConversation());
  const messages = $derived(visibleMessages());
  const busy = $derived(isSending());
  const status = $derived(chatStatus());
  const error = $derived(chatError());
  const unavailable = $derived(status !== null && !status.available);
  const isLive = $derived(orchestratorMode === "running" || orchestratorMode === "stopping");
  // Only Claude Code exposes a model choice here; the API backend picks its own.
  const models = $derived(status?.backend === "claude-code" ? modelsForProvider("claude-code") : []);

  async function refreshOrchestratorMode() {
    try {
      const response = await fetch(apiUrl("/orchestrator/state"));
      orchestratorMode = response.ok
        ? (((await response.json()) as { state?: { mode?: string } }).state?.mode ?? null)
        : null;
    } catch {
      orchestratorMode = null;
    }
  }

  function attachBus() {
    bus?.close();
    bus = new EventSource(apiUrl("/events"));
    bus.addEventListener("orchestrator.changed", () => void refreshOrchestratorMode());
  }

  // One effect owns project-bound setup: it runs on mount with the initial id
  // and again on every switch, because App resolves the project after paint.
  let lastProjectId: string | null | undefined = undefined;
  $effect(() => {
    const id = projectId;
    if (id === lastProjectId) return;
    lastProjectId = id;
    showHistory = false;
    void loadChat();
    void loadProviders();
    attachBus();
    void refreshOrchestratorMode();
  });

  $effect(() => {
    // Follow the stream as it grows, but only while it is growing.
    void streamingTurn()?.content;
    void messages.length;
    void scrollToBottom();
  });

  onMount(() => {
    window.addEventListener("keydown", handleGlobalKey);
  });

  onDestroy(() => {
    bus?.close();
    window.removeEventListener("keydown", handleGlobalKey);
  });

  function handleGlobalKey(event: KeyboardEvent) {
    if (!open && !embedded) return;

    // Cmd/Ctrl+K opens a fresh thread from anywhere, the way a command palette
    // would; Cmd/Ctrl+F reaches the conversation search.
    if ((event.metaKey || event.ctrlKey) && event.key === "k") {
      event.preventDefault();
      void startConversation();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key === "f") {
      event.preventDefault();
      showHistory = true;
      return;
    }

    if (event.key !== "Escape") return;
    // Escape unwinds one layer at a time: the history panel, then the turn in
    // flight, then the drawer itself.
    if (showHistory) {
      showHistory = false;
    } else if (busy) {
      stopStreaming();
    } else if (!embedded) {
      onClose();
    }
  }

  async function scrollToBottom() {
    await tick();
    if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
  }

  /** Approving is sent as a message: the two-step gate stays in the transcript
   *  and both backends behave identically. The button is a shortcut, not a
   *  bypass of the confirmation protocol. */
  function confirmPending() {
    void sendMessage(t("chat.confirm_message"));
  }

  function cancelPending() {
    void sendMessage(t("chat.cancel_message"));
  }

  function runCommand(name: string): boolean {
    if (name === "clear") {
      void resetContext();
      return true;
    }
    if (name === "new") {
      void startConversation();
      return true;
    }
    if (name === "help") {
      showHistory = false;
      void sendMessage(t("chat.help_message"));
      return true;
    }
    return false;
  }

  async function emergency(action: "pause" | "stop") {
    if (actionBusy) return;
    const label = action === "pause" ? t("chat.confirm_pause") : t("chat.confirm_stop");
    if (!window.confirm(label)) return;
    actionBusy = action;
    try {
      await (action === "pause" ? pauseOrchestrator() : stopOrchestrator());
      await refreshOrchestratorMode();
    } finally {
      actionBusy = null;
    }
  }
</script>

{#if open || embedded}
  <aside class="drawer" class:embedded aria-label={t("chat.title")}>
    <header>
      <div class="identity">
        <h2>{conversation?.title ?? t("chat.title")}</h2>
        {#if models.length > 0}
          <select
            class="model"
            value={conversation?.model ?? ""}
            onchange={(event) =>
              void setConversationModel((event.currentTarget as HTMLSelectElement).value || null)}
            title={t("chat.model_hint")}
            aria-label={t("chat.model_label")}
            disabled={busy || !conversation}
          >
            <option value="">{t("chat.model_default")}</option>
            {#each models as model (model.value)}
              <option value={model.value}>{model.value}</option>
            {/each}
          </select>
        {:else if status?.backend}
          <span class="backend" title={t("chat.backend_hint")}>{status.backend}</span>
        {/if}
      </div>

      <div class="actions">
        {#if isLive}
          <button
            class="brake"
            onclick={() => emergency("pause")}
            disabled={actionBusy !== null || orchestratorMode !== "running"}
            title={t("chat.action_pause")}
          >
            <Icon name="pause" size={12} />
          </button>
          <button
            class="brake"
            onclick={() => emergency("stop")}
            disabled={actionBusy !== null || orchestratorMode === "idle"}
            title={t("chat.action_stop")}
          >
            <Icon name="stop" size={12} />
          </button>
        {/if}
        <button onclick={() => (showHistory = !showHistory)} title={t("chat.history_title")}>
          <Icon name="history" size={12} />
        </button>
        <button onclick={() => void startConversation()} title={t("chat.new")} disabled={busy}>
          <Icon name="plus" size={12} />
        </button>
        {#if !embedded}
          <button onclick={onClose} title={t("chat.close_hint")} aria-label={t("chat.close")}>
            <Icon name="close" size={12} />
          </button>
        {/if}
      </div>
    </header>

    <div class="body">
      {#if showHistory}
        <ConversationList
          conversations={chatConversations()}
          currentId={conversation?.id ?? null}
          query={chatSearch()}
          onsearch={(query) => void setChatSearch(query)}
          onopen={(id) => {
            void openConversation(id);
            showHistory = false;
          }}
          ondelete={(id) => void removeConversation(id)}
          onclose={() => (showHistory = false)}
        />
      {/if}

      <div class="conversation" bind:this={scrollEl}>
        {#if unavailable}
          <p class="notice">{status?.detail ?? t("chat.unavailable")}</p>
        {:else if messages.length === 0}
          <p class="notice">{t("chat.intro")}</p>
        {/if}

        {#each messages as message, index (`${message.at}-${index}`)}
          <Message
            {message}
            streaming={busy && index === messages.length - 1}
            {busy}
            onedit={message.role === "user" && !busy ? (text) => void editAndResend(index, text) : undefined}
            onregenerate={message.role === "assistant" && index === messages.length - 1 && !busy
              ? () => void regenerate()
              : undefined}
            onconfirm={confirmPending}
            oncancel={cancelPending}
          />
        {/each}

        {#if error}
          <p class="failed">{error}</p>
        {/if}
      </div>
    </div>

    <Composer
      {busy}
      disabled={unavailable}
      onsend={(text) => void sendMessage(text)}
      onstop={stopStreaming}
      oncommand={runCommand}
    />
  </aside>
{/if}

<style>
  .drawer {
    position: fixed;
    top: 0;
    right: 0;
    width: min(380px, 92vw);
    height: 100vh;
    height: 100dvh;
    background: var(--bg-surface);
    border-left: 1px solid var(--border-default);
    box-shadow: var(--elev-panel-left);
    z-index: 50;
    display: flex;
    flex-direction: column;
  }

  .drawer.embedded {
    position: relative;
    width: 100%;
    height: 100%;
    border-left: none;
    box-shadow: none;
    z-index: auto;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border-default);
    flex-shrink: 0;
  }

  .identity {
    min-width: 0;
    display: flex;
    align-items: baseline;
    gap: 8px;
  }

  h2 {
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-strong);
  }

  /* Which engine is answering changes the cost and the speed, so it is stated
     rather than left to be guessed. Machine name, machine voice. */
  .backend {
    flex-shrink: 0;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 10px;
    color: var(--text-muted);
  }

  /* The model reads as metadata, not as a form control: no chrome until you
     reach for it. */
  .model {
    flex-shrink: 0;
    max-width: 120px;
    padding: 1px 2px;
    border: 1px solid transparent;
    border-radius: 3px;
    background: transparent;
    color: var(--text-muted);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 10px;
    cursor: pointer;
  }

  .model:hover:not(:disabled) {
    border-color: var(--border-field);
    color: var(--text-body);
  }

  .model:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .model:disabled {
    cursor: default;
  }

  .actions {
    display: flex;
    gap: 2px;
  }

  .actions button {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: var(--tap-size);
    min-height: var(--tap-size);
    border: none;
    border-radius: 3px;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    transition:
      background 120ms ease,
      color 120ms ease;
  }

  .actions button:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-body);
  }

  .actions button:disabled {
    color: var(--text-subtle);
    cursor: default;
  }

  .actions button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .actions .brake:hover:not(:disabled) {
    background: var(--warning-bg);
    color: var(--warning);
  }

  .body {
    position: relative;
    flex: 1;
    min-height: 0;
  }

  .conversation {
    height: 100%;
    overflow-y: auto;
    padding: 0 12px;
  }

  .notice {
    margin: 16px 0;
    color: var(--text-muted);
    font-size: 12px;
    line-height: 1.5;
  }

  .failed {
    margin: 8px 0;
    padding: 6px 8px;
    border-radius: 4px;
    background: var(--danger-bg);
    color: var(--danger);
    font-size: 12px;
  }
</style>
