<script lang="ts">
  // Agent dropdown sitting next to the topbar Play button. The user
  // picks ONE agent that will execute the next run — replacing the
  // older "toggle each agent enabled" flow which made it ambiguous
  // who would run the task. Selection persists per-project so each
  // project remembers its preferred runner.
  import { onDestroy } from "svelte";
  import { t } from "./i18n.svelte.js";
  import { formatAgentLabel } from "./agent-label.js";
  import type { AgentSummary } from "./types.js";

  interface Props {
    agents: AgentSummary[];
    selectedId: string | null;
    onSelect: (id: string | null) => void;
    onManageAgents: () => void;
    variant?: "standalone" | "inline";
  }

  let { agents, selectedId, onSelect, onManageAgents, variant = "standalone" }: Props = $props();

  let open = $state(false);
  let containerEl = $state<HTMLDivElement | null>(null);

  // Only AI providers can actually run a task. Manual is a marker for
  // human assignees and shouldn't show up in this picker.
  function isExecutable(a: AgentSummary): boolean {
    return a.provider === "claude" || a.provider === "codex" || a.provider === "custom";
  }
  // Sort: ready agents first (no API key issue), then the ones still
  // waiting for credentials. The picker stays open to all so the user
  // can see they exist + click through to the key dialog if needed.
  const executable = $derived(
    agents.filter(isExecutable).slice().sort((a, b) => {
      const aReady = !a.needs_api_key ? 0 : 1;
      const bReady = !b.needs_api_key ? 0 : 1;
      return aReady - bReady;
    }),
  );
  const selected = $derived(executable.find((a) => a.id === selectedId) ?? null);
  const defaultAgent = $derived(executable.find((a) => !a.needs_api_key) ?? executable[0] ?? null);
  const visibleAgent = $derived(selected ?? defaultAgent);
  const selectedLabel = $derived(visibleAgent ? formatAgentLabel(visibleAgent) : null);
  const triggerLabel = $derived(
    selectedLabel ? selectedLabel.withContext
      : t("agent_picker.none"),
  );

  function toggle() { open = !open; }
  function close() { open = false; }

  function handleDocumentClick(e: MouseEvent) {
    if (!open) return;
    if (containerEl && !containerEl.contains(e.target as Node)) close();
  }
  function handleKey(e: KeyboardEvent) {
    if (open && e.key === "Escape") close();
  }
  $effect(() => {
    if (open) {
      window.addEventListener("click", handleDocumentClick);
      window.addEventListener("keydown", handleKey);
    } else {
      window.removeEventListener("click", handleDocumentClick);
      window.removeEventListener("keydown", handleKey);
    }
  });
  onDestroy(() => {
    window.removeEventListener("click", handleDocumentClick);
    window.removeEventListener("keydown", handleKey);
  });

  function pick(id: string | null) {
    close();
    onSelect(id);
  }
</script>

<div class="agent-picker" bind:this={containerEl}>
  <button
    class="trigger"
    class:inline={variant === "inline"}
    type="button"
    onclick={toggle}
    aria-haspopup="listbox"
    aria-expanded={open}
    title={visibleAgent?.model ? `${visibleAgent.id} · ${visibleAgent.model}` : t("agent_picker.auto_hint")}
  >
    <span class="bot-icon" aria-hidden="true">🤖</span>
    <span class="name">{triggerLabel}</span>
    <span class="chevron" aria-hidden="true">▾</span>
  </button>

  {#if open}
    <div class="menu" role="listbox">
      <button
        class="item"
        class:active={selectedId === null}
        onclick={() => pick(null)}
        title={t("agent_picker.auto_hint")}
      >
        <span class="item-name">
          {t("agent_picker.auto_select")}
          {#if defaultAgent}
            <small>{formatAgentLabel(defaultAgent).withContext}</small>
          {/if}
        </span>
        {#if selectedId === null}<span class="check">✓</span>{/if}
      </button>
      <div class="separator"></div>
      {#if executable.length === 0}
        <div class="empty-row">{t("agent_picker.empty")}</div>
      {:else}
        {#each executable as agent (agent.id)}
          {@const label = formatAgentLabel(agent)}
          <button
            class="item"
            class:active={agent.id === selectedId}
            class:dim={agent.needs_api_key}
            onclick={() => pick(agent.id)}
            title={agent.needs_api_key ? t("agent_picker.needs_api_key_hint", { key: agent.required_secret_key ?? "" }) : `${agent.id} · ${agent.model ?? agent.provider}`}
          >
            <span class="provider provider-{agent.provider}">{agent.provider}</span>
            <span class="item-name">{label.withContext}</span>
            {#if agent.needs_api_key}<span class="off">🔑 key</span>{/if}
            {#if agent.id === selectedId}<span class="check">✓</span>{/if}
          </button>
        {/each}
      {/if}
      <div class="separator"></div>
      <button class="item action" onclick={() => { close(); onManageAgents(); }}>
        <span class="item-name">⚙ {t("agent_picker.manage")}</span>
      </button>
    </div>
  {/if}
</div>

<style>
  .agent-picker {
    position: relative;
    display: inline-flex;
  }
  .trigger {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: var(--bg-input);
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    padding: 5px 8px;
    cursor: pointer;
    font: inherit;
    font-size: 12.5px;
    color: var(--text-primary);
    height: 32px;
    max-width: 210px;
    min-width: 0;
  }
  .trigger:hover {
    border-color: var(--accent);
  }
  .trigger.inline {
    height: 100%;
    max-width: min(300px, 28vw);
    border: none;
    background: transparent;
    padding: 0;
  }
  .trigger.inline:hover {
    color: var(--accent-text);
    border-color: transparent;
  }
  .bot-icon { font-size: 12px; flex-shrink: 0; line-height: 1; }
  .name {
    font-weight: 500;
    min-width: 0;
    max-width: 210px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .trigger.inline .name {
    font-weight: 700;
    max-width: min(250px, 24vw);
  }
  .chevron {
    font-size: 16px;
    font-weight: 700;
    color: var(--text-muted);
    line-height: 1;
    margin-left: 2px;
  }

  .menu {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    min-width: 320px;
    background: var(--bg-surface);
    border: 1px solid var(--border-default);
    border-radius: 6px;
    box-shadow: var(--shadow-modal);
    padding: 4px;
    z-index: 60;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 8px;
    background: transparent;
    border: none;
    padding: 6px 10px;
    border-radius: 4px;
    cursor: pointer;
    text-align: left;
    color: var(--text-body);
    font-size: 13px;
    width: 100%;
  }
  .item:hover { background: var(--bg-hover); color: var(--text-primary); }
  .item.active { color: var(--text-primary); font-weight: 500; }
  .item.dim { opacity: 0.55; }
  .item.action { color: var(--text-secondary); font-size: 12px; }

  .provider {
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 1px 5px;
    border-radius: 3px;
    color: white;
    font-weight: 600;
    flex-shrink: 0;
  }
  .provider-claude { background: var(--danger); }
  .provider-codex { background: var(--success); }
  .provider-custom { background: #a78bfa; }
  .item-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .item-name small {
    color: var(--text-muted);
    font-size: 10px;
    font-weight: 500;
  }
  .item-model {
    font-family: ui-monospace, monospace;
    font-size: 10px;
    color: var(--text-muted);
    flex-shrink: 0;
  }
  .off {
    font-size: 9px;
    color: var(--text-muted);
    background: var(--bg-hover);
    padding: 1px 5px;
    border-radius: 8px;
  }
  .check {
    color: var(--accent);
    font-size: 12px;
    flex-shrink: 0;
  }
  .empty-row {
    padding: 8px 10px;
    color: var(--text-muted);
    font-size: 12px;
    font-style: italic;
  }
  .separator {
    height: 1px;
    background: var(--border-subtle);
    margin: 4px 0;
  }
</style>
