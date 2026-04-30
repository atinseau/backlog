<script lang="ts">
  // Generic popup menu used by Card.svelte (and re-usable for other
  // contexts later — sub-task rows, run history, etc.). Shows a list
  // of actions plus optional submenus (priority picker, assign
  // picker). The trigger lives outside; this component just renders
  // the menu when `open` is true.
  //
  // Positioning: caller passes anchor coordinates (clientX/clientY),
  // we clamp into the viewport so the menu doesn't get cut off near
  // the right edge or bottom of the screen. Closes on:
  //   - any outside click
  //   - Escape
  //   - clicking an item (after the action runs)
  //
  // The menu is fully keyboard-navigable: ↑/↓ moves the highlight,
  // → opens a submenu, ← closes it, Enter / Space activates.

  import { onMount, tick } from "svelte";
  import type { MenuItem } from "./card-menu-types.js";

  interface Props {
    open: boolean;
    items: MenuItem[];
    anchor: { x: number; y: number } | null;
    onClose: () => void;
  }

  let { open, items, anchor, onClose }: Props = $props();

  // Portal action — moves the menu element straight onto <body> on
  // mount, then back to its original parent on destroy. Critical
  // because the parent <article class="card"> can have a CSS transform
  // applied at any time (svelte-dnd-action sets `transform: matrix(…)`
  // during FLIP animations and even after, on idle, leaves a 1px y
  // residue). Any non-identity ancestor transform turns `position:
  // fixed` into "fixed within the transformed ancestor" instead of
  // "fixed within the viewport" — so the menu would render hundreds
  // of pixels offset from the kebab. Portaling sidesteps the entire
  // class of bugs by detaching the menu from the card subtree.
  function portal(node: HTMLElement) {
    const original = node.parentElement;
    document.body.appendChild(node);
    return {
      destroy() {
        if (original && original.isConnected) {
          original.appendChild(node);
        } else {
          node.remove();
        }
      },
    };
  }

  let menuEl = $state<HTMLDivElement | null>(null);
  let openSubmenu = $state<number | null>(null);
  let highlight = $state<number>(-1);

  // Frozen-on-open position. Computed ONCE when the menu opens, then
  // held stable for the lifetime of that open session. Earlier we used
  // a $derived.by that depended on `items.length`, which made the
  // position recompute every time the parent re-rendered the menu —
  // and the parent re-renders all the time (assigneesForMenu fetches
  // async, SSE board updates change card props, etc.). Each recompute
  // would briefly produce a slightly different y-clamp, visible to the
  // user as a flicker between "correct anchor" and "shifted clamp".
  // Snapshotting once means the menu stays put until you close it.
  let position = $state<{ x: number; y: number }>({ x: 0, y: 0 });
  let lastAnchorKey = "";

  function freezePosition(): void {
    if (!anchor) return;
    const margin = 8;
    const w = 220;          // matches .menu min-width
    // Use a generous height estimate so a menu opened near the screen
    // bottom slides up enough to fully fit. Real height is computed
    // post-mount by the browser; this is just for clamping.
    const h = Math.max(items.length, 6) * 32 + 12;
    const x = Math.min(anchor.x, window.innerWidth - w - margin);
    const y = Math.min(anchor.y, window.innerHeight - h - margin);
    position = { x: Math.max(margin, x), y: Math.max(margin, y) };
  }

  function handleDocumentClick(event: MouseEvent) {
    if (!open) return;
    if (menuEl && !menuEl.contains(event.target as Node)) onClose();
  }

  function handleKey(event: KeyboardEvent) {
    if (!open) return;
    const visibleItems = items.filter((it) => !it.separator);
    if (event.key === "Escape") {
      event.preventDefault();
      if (openSubmenu !== null) {
        openSubmenu = null;
      } else {
        onClose();
      }
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      highlight = (highlight + 1) % visibleItems.length;
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      highlight = (highlight - 1 + visibleItems.length) % visibleItems.length;
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const item = visibleItems[highlight];
      if (item) activate(items.indexOf(item), item);
    }
  }

  async function activate(index: number, item: MenuItem) {
    if (item.disabled || item.separator) return;
    if (item.submenu && item.submenu.length > 0) {
      openSubmenu = openSubmenu === index ? null : index;
      return;
    }
    if (item.onSelect) {
      try {
        await item.onSelect();
      } finally {
        onClose();
      }
    } else {
      onClose();
    }
  }

  $effect(() => {
    if (open && anchor) {
      // Re-freeze position only when the anchor identity changes —
      // i.e. a fresh open from a different click. Same anchor on
      // re-render = no recompute = no flicker.
      const key = `${anchor.x},${anchor.y}`;
      if (key !== lastAnchorKey) {
        lastAnchorKey = key;
        freezePosition();
      }
      tick().then(() => menuEl?.focus());
    } else if (!open) {
      openSubmenu = null;
      highlight = -1;
      lastAnchorKey = "";
    }
  });

  onMount(() => {
    document.addEventListener("mousedown", handleDocumentClick, { capture: true });
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleDocumentClick, { capture: true });
      document.removeEventListener("keydown", handleKey);
    };
  });
</script>

{#if open && anchor}
  <div
    class="menu"
    bind:this={menuEl}
    use:portal
    role="menu"
    tabindex="-1"
    style="left: {position.x}px; top: {position.y}px"
  >
    {#each items as item, index (index)}
      {#if item.separator}
        <div class="separator" role="separator"></div>
      {:else}
        <button
          type="button"
          role="menuitem"
          class="item"
          class:danger={item.danger}
          class:disabled={item.disabled}
          class:has-submenu={Boolean(item.submenu && item.submenu.length > 0)}
          class:active={highlight === index}
          disabled={item.disabled}
          onclick={(e) => { e.stopPropagation(); activate(index, item); }}
          onmouseenter={() => { highlight = index; if (item.submenu) openSubmenu = index; }}
        >
          {#if item.icon}<span class="icon" aria-hidden="true">{item.icon}</span>{/if}
          <span class="label">{item.label}</span>
          {#if item.submenu && item.submenu.length > 0}
            <span class="chevron" aria-hidden="true">›</span>
          {/if}
        </button>
        {#if openSubmenu === index && item.submenu}
          <div class="submenu" role="menu">
            {#each item.submenu as sub, subIndex (subIndex)}
              {#if sub.separator}
                <div class="separator" role="separator"></div>
              {:else}
                <button
                  type="button"
                  role="menuitem"
                  class="item"
                  class:danger={sub.danger}
                  class:disabled={sub.disabled}
                  disabled={sub.disabled}
                  onclick={(e) => { e.stopPropagation(); activate(subIndex, sub); }}
                >
                  {#if sub.icon}<span class="icon" aria-hidden="true">{sub.icon}</span>{/if}
                  <span class="label">{sub.label}</span>
                </button>
              {/if}
            {/each}
          </div>
        {/if}
      {/if}
    {/each}
  </div>
{/if}

<style>
  .menu {
    position: fixed;
    z-index: 9000;
    min-width: 220px;
    background: var(--bg-surface);
    color: var(--text-primary);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
    padding: 4px;
    outline: none;
    user-select: none;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 10px;
    background: transparent;
    border: 0;
    border-radius: 5px;
    color: inherit;
    cursor: pointer;
    text-align: left;
    font: inherit;
    font-size: 13px;
    line-height: 1.3;
  }
  .item:hover:not(.disabled),
  .item.active:not(.disabled) {
    background: var(--bg-hover, rgba(0, 0, 0, 0.06));
  }
  .item.disabled {
    color: var(--text-subtle);
    cursor: not-allowed;
  }
  .item.danger {
    color: #d92d20;
  }
  .item.danger:hover:not(.disabled) {
    background: rgba(217, 45, 32, 0.08);
  }
  .icon {
    width: 16px;
    text-align: center;
    flex-shrink: 0;
  }
  .label {
    flex: 1;
  }
  .chevron {
    color: var(--text-subtle);
    font-size: 14px;
    line-height: 1;
  }
  .separator {
    height: 1px;
    background: var(--border);
    margin: 4px 0;
  }
  .submenu {
    position: absolute;
    left: 100%;
    top: 0;
    min-width: 180px;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
    padding: 4px;
    margin-left: 4px;
  }
</style>
