<script lang="ts">
  // Agent dropdown sitting next to the topbar Play button. The user
  // picks ONE agent that will execute the next run — replacing the
  // older "toggle each agent enabled" flow which made it ambiguous
  // who would run the task. Selection persists per-project so each
  // workspace remembers its preferred runner.
  import { onDestroy } from "svelte";
  import { t } from "./i18n.svelte.js";
  import type { AgentSummary } from "./types.js";

  interface Props {
    agents: AgentSummary[];
    selectedId: string | null;
    onSelect: (id: string | null) => void;
    onManageAgents: () => void;
  }

  let { agents, selectedId, onSelect, onManageAgents }: Props = $props();

  let open = $state(false);
  let containerEl = $state<HTMLDivElement | null>(null);

  // Only AI providers can actually run a task. Manual is a marker for
  // human assignees and shouldn't show up in this picker.
  function isExecutable(a: AgentSummary): boolean {
    return a.provider === "claude" || a.provider === "codex" || a.provider === "custom";
  }
  const executable = $derived(agents.filter(isExecutable));
  const selected = $derived(executable.find((a) => a.id === selectedId) ?? null);
  const triggerLabel = $derived(
    selected ? selected.id : executable.length === 0 ? t("agent_picker.none") : t("agent_picker.choose"),
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
    type="button"
    onclick={toggle}
    aria-haspopup="listbox"
    aria-expanded={open}
    title={selected?.model ? `${selected.id} · ${selected.model}` : t("agent_picker.tooltip")}
  >
    <span class="bot-icon" aria-hidden="true">🤖</span>
    <span class="name">{triggerLabel}</span>
    {#if selected?.model}<span class="model">{selected.model}</span>{/if}
    <span class="chevron" aria-hidden="true">▾</span>
  </button>

  {#if open}
    <div class="menu" role="listbox">
      {#if executable.length === 0}
        <div class="empty-row">{t("agent_picker.empty")}</div>
      {:else}
        {#each executable as agent (agent.id)}
          <button
            class="item"
            class:active={agent.id === selectedId}
            class:dim={!agent.enabled}
            onclick={() => pick(agent.id)}
            title={agent.enabled ? "" : t("agent_picker.disabled_hint")}
          >
            <span class="provider provider-{agent.provider}">{agent.provider}</span>
            <span class="item-name">{agent.id}</span>
            {#if agent.model}<span class="item-model">{agent.model}</span>{/if}
            {#if !agent.enabled}<span class="off">off</span>{/if}
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
  }
  .trigger:hover {
    border-color: var(--accent);
  }
  .bot-icon { font-size: 12px; flex-shrink: 0; line-height: 1; }
  .name { font-weight: 500; }
  .model {
    font-family: ui-monospace, monospace;
    font-size: 10px;
    background: var(--bg-elevated);
    color: var(--text-secondary);
    padding: 1px 5px;
    border-radius: 3px;
  }
  .chevron {
    font-size: 12px;
    color: var(--text-muted);
    line-height: 1;
  }

  .menu {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    min-width: 240px;
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

  .item-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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
