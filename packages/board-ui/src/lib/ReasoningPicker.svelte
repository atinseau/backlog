<script lang="ts">
  import { onDestroy, tick } from "svelte";
  import { reasoningLevelsForProvider } from "./providers.svelte.js";
  import { t } from "./i18n.svelte.js";

  interface Props {
    provider: string | null;
    value: string | null;
    onSelect: (value: string) => void;
  }

  let { provider, value, onSelect }: Props = $props();

  let open = $state(false);
  let containerEl = $state<HTMLDivElement | null>(null);
  let menuEl = $state<HTMLDivElement | null>(null);
  let menuStyle = $state("");

  const options = $derived(reasoningLevelsForProvider(provider));
  const selected = $derived(options.find((option) => option.value === value) ?? options[0] ?? null);
  const MENU_GUTTER = 12;

  async function updateMenuPosition() {
    if (!open || !containerEl) return;
    await tick();
    const triggerRect = containerEl.getBoundingClientRect();
    const menuRect = menuEl?.getBoundingClientRect();
    const menuWidth = menuRect?.width ?? Math.min(260, window.innerWidth - MENU_GUTTER * 2);
    const left = Math.max(
      MENU_GUTTER,
      Math.min(triggerRect.left, window.innerWidth - menuWidth - MENU_GUTTER),
    );
    const top = Math.min(triggerRect.bottom + 6, window.innerHeight - MENU_GUTTER);
    menuStyle = [
      `left: ${Math.round(left)}px`,
      `top: ${Math.round(top)}px`,
      `max-height: ${Math.round(Math.max(180, window.innerHeight - top - MENU_GUTTER))}px`,
    ].join("; ");
  }

  function requestMenuPosition() {
    void updateMenuPosition();
  }

  function toggle() {
    if (options.length === 0) return;
    open = !open;
    if (open) requestMenuPosition();
  }

  function close() {
    open = false;
  }

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

  function pick(next: string) {
    close();
    onSelect(next);
  }
</script>

{#if selected}
  <div class="reasoning-picker" bind:this={containerEl}>
    <button
      class="trigger"
      type="button"
      onclick={toggle}
      aria-haspopup="listbox"
      aria-expanded={open}
      title={`${t("reasoning_picker.title")}: ${selected.value}`}
    >
      <span class="name">{selected.label}</span>
      <span class="chevron" aria-hidden="true">▾</span>
    </button>

    {#if open}
      <div class="menu" role="listbox" bind:this={menuEl} style={menuStyle}>
        {#each options as option (option.value)}
          <button
            class="item"
            class:active={option.value === selected.value}
            type="button"
            onclick={() => pick(option.value)}
            title={option.description}
          >
            <span class="item-name">{option.label}</span>
            {#if option.value === selected.value}<span class="check">✓</span>{/if}
          </button>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .reasoning-picker {
    position: relative;
    display: inline-flex;
  }
  .trigger {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: none;
    background: transparent;
    padding: 4px 8px;
    cursor: pointer;
    font: inherit;
    font-size: 13px;
    font-weight: 400;
    color: var(--text-primary);
    max-width: min(120px, 12vw);
    min-width: 0;
  }
  .trigger:hover {
    color: var(--accent-text);
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
    width: min(220px, calc(100vw - 24px));
    min-width: min(180px, calc(100vw - 24px));
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
  .item-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .check {
    color: var(--accent);
    font-size: 12px;
    flex-shrink: 0;
  }
</style>
