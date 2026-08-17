<script lang="ts">
  import { isExecutableAgent } from "./types.js";
  // Agent dropdown sitting next to the project name. The user picks ONE
  // agent/model that will execute the next run; the app persists that
  // choice per project and falls back to the last ready configured agent.
  import { onDestroy, tick } from "svelte";
  import { t } from "./i18n.svelte.js";
  import { formatAgentLabel } from "./agent-label.js";
  import type { AgentSummary } from "./types.js";

  interface Props {
    agents: AgentSummary[];
    selectedId: string | null;
    onSelect: (id: string) => void;
    onManageAgents: () => void;
    variant?: "standalone" | "inline";
  }

  let { agents, selectedId, onSelect, onManageAgents, variant = "standalone" }: Props = $props();

  let open = $state(false);
  let containerEl = $state<HTMLDivElement | null>(null);
  let menuEl = $state<HTMLDivElement | null>(null);
  let menuStyle = $state("");

  // Only AI providers can actually run a task. Manual is a marker for
  // human assignees and shouldn't show up in this picker.
  function isExecutable(a: AgentSummary): boolean {
    return isExecutableAgent(a);
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
  function fallbackAgent(): AgentSummary | null {
    const ready = agents.filter((agent) => isExecutable(agent) && !agent.needs_api_key);
    if (ready.length > 0) return ready[ready.length - 1] ?? null;
    const all = agents.filter(isExecutable);
    return all[all.length - 1] ?? null;
  }

  const selected = $derived(executable.find((a) => a.id === selectedId) ?? null);
  const defaultAgent = $derived(fallbackAgent());
  const visibleAgent = $derived(selected ?? defaultAgent);
  const effectiveSelectedId = $derived(visibleAgent?.id ?? null);
  const selectedLabel = $derived(visibleAgent ? formatAgentLabel(visibleAgent) : null);
  const triggerLabel = $derived(
    selectedLabel ? selectedLabel.withContext
      : t("agent_picker.none"),
  );

  const MENU_GUTTER = 12;

  async function updateMenuPosition() {
    if (!open || !containerEl) return;
    await tick();
    const triggerRect = containerEl.getBoundingClientRect();
    const menuRect = menuEl?.getBoundingClientRect();
    const menuWidth = menuRect?.width ?? Math.min(420, window.innerWidth - MENU_GUTTER * 2);
    const preferredLeft = variant === "inline" ? triggerRect.left : triggerRect.right - menuWidth;
    const left = Math.max(
      MENU_GUTTER,
      Math.min(preferredLeft, window.innerWidth - menuWidth - MENU_GUTTER),
    );
    const top = Math.min(triggerRect.bottom + 6, window.innerHeight - MENU_GUTTER);
    const maxWidth = Math.max(240, window.innerWidth - MENU_GUTTER * 2);
    const maxHeight = Math.max(180, window.innerHeight - top - MENU_GUTTER);
    menuStyle = [
      `left: ${Math.round(left)}px`,
      `top: ${Math.round(top)}px`,
      `max-width: ${Math.round(maxWidth)}px`,
      `max-height: ${Math.round(maxHeight)}px`,
    ].join("; ");
  }

  function requestMenuPosition() {
    void updateMenuPosition();
  }

  function toggle() {
    open = !open;
    if (!open) return;
    requestMenuPosition();
  }
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
      window.addEventListener("resize", requestMenuPosition);
      window.addEventListener("scroll", requestMenuPosition, true);
      requestMenuPosition();
    } else {
      window.removeEventListener("click", handleDocumentClick);
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("resize", requestMenuPosition);
      window.removeEventListener("scroll", requestMenuPosition, true);
    }
  });
  onDestroy(() => {
    window.removeEventListener("click", handleDocumentClick);
    window.removeEventListener("keydown", handleKey);
    window.removeEventListener("resize", requestMenuPosition);
    window.removeEventListener("scroll", requestMenuPosition, true);
  });

  function pick(id: string) {
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
    title={visibleAgent?.model ? `${visibleAgent.id} · ${visibleAgent.model}` : t("agent_picker.none")}
  >
    <span class="bot-icon" aria-hidden="true">🤖</span>
    <span class="trigger-text">
      <span class="name">{triggerLabel}</span>
    </span>
    <span class="chevron" aria-hidden="true">▾</span>
  </button>

  {#if open}
    <div class="menu" role="listbox" bind:this={menuEl} style={menuStyle}>
      {#if executable.length === 0}
        <div class="empty-row">{t("agent_picker.empty")}</div>
      {:else}
        {#each executable as agent (agent.id)}
          {@const label = formatAgentLabel(agent)}
          <button
            class="item"
            class:active={agent.id === effectiveSelectedId}
            class:dim={agent.needs_api_key}
            onclick={() => pick(agent.id)}
            title={agent.needs_api_key ? t("agent_picker.needs_api_key_hint", { key: agent.required_secret_key ?? "" }) : `${agent.id} · ${agent.model ?? agent.provider}`}
          >
            <span class="provider provider-{agent.provider}">{agent.provider}</span>
            <span class="item-name">{label.withContext}</span>
            {#if agent.needs_api_key}<span class="off">🔑 {t("agent_picker.needs_api_key_badge")}</span>{/if}
            {#if agent.id === effectiveSelectedId}<span class="check">✓</span>{/if}
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
    /* Select-shaped control on --bg-input: WCAG 1.4.11 wants 3:1. */
    border: 1px solid var(--border-field);
    border-radius: 4px;
    padding: 5px 8px;
    cursor: pointer;
    font: inherit;
    font-size: 12px;
    color: var(--text-primary);
    height: 32px;
    max-width: 210px;
    min-width: 0;
  }
  .trigger:hover {
    border-color: var(--accent);
  }
  .trigger.inline {
    height: auto;
    width: auto;
    max-width: min(280px, 24vw);
    border: none;
    background: transparent;
    padding: 4px 8px;
    justify-content: flex-start;
  }
  .trigger.inline:hover {
    color: var(--accent-text);
    border-color: transparent;
  }
  .bot-icon { font-size: 12px; flex-shrink: 0; line-height: 1; }
  .trigger.inline .bot-icon { display: none; }
  .trigger-text {
    min-width: 0;
    max-width: 210px;
    display: flex;
    align-items: center;
    text-align: left;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .name {
    font-weight: 500;
  }
  .trigger.inline .name {
    font-size: 13px;
    font-weight: 400;
    color: var(--text-primary);
  }
  .trigger.inline .trigger-text {
    max-width: min(230px, 20vw);
  }
  .chevron {
    font-size: 16px;
    font-weight: 700;
    color: var(--text-muted);
    line-height: 1;
    margin-left: 2px;
  }

  .menu {
    position: fixed;
    width: min(420px, calc(100vw - 24px));
    min-width: min(320px, calc(100vw - 24px));
    background: var(--bg-surface);
    border: 1px solid var(--border-default);
    border-radius: 6px;
    box-shadow: var(--shadow-modal);
    padding: 4px;
    z-index: 90;
    display: flex;
    flex-direction: column;
    gap: 1px;
    overflow: auto;
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

  /* No shared `color` here: each variant paints a different fill, so
     each one carries its own paired ink (DESIGN.md, encre appariée). */
  .provider {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 1px 5px;
    border-radius: 3px;
    font-weight: 600;
    flex-shrink: 0;
  }
  .provider-claude { background: var(--danger); color: var(--danger-on); }
  .provider-codex { background: var(--success); color: var(--success-on); }
  .provider-custom { background: var(--apply); color: var(--apply-on); }
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
  .item-model {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px;
    color: var(--text-muted);
    flex-shrink: 0;
  }
  .off {
    font-size: 11px;
    color: var(--text-muted);
    background: var(--bg-hover);
    /* Deliberately round: it reads as a counter-style pill. */
    border-radius: 999px;
    padding: 1px 6px;
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
