<script lang="ts">
  // Single global popup menu, driven by cardMenuStore. Rendered ONCE
  // at App.svelte level inside the shell — never inside a Card. The
  // earlier per-card design suffered from two structural problems:
  //
  // - svelte-dnd-action leaves a residual CSS transform on each
  //   <article class="card"> (matrix(1,0,0,1,0,-1) — a 1px y-translate
  //   from FLIP animations, invisible but enough to create a
  //   containing block). With a transformed ancestor, `position: fixed`
  //   stops being viewport-relative — it gets re-anchored to that
  //   transformed parent, and the menu rendered ~270px off-target.
  // - Each card holding its own menu state plus its own document-level
  //   mousedown listener for outside-click made the close logic
  //   non-deterministic during fast cursor movements between cards
  //   ("on sort la souris, on revient → menu clignote / disparaît").
  //
  // Hoisting fixes both: the menu is fixed-positioned to the viewport
  // because it's rendered at the App-shell level (no transformed
  // ancestor), and there's only one menu state to coordinate, period.
  //
  // Positioning: the store's `anchor` is set by Card.svelte on kebab
  // click via `getBoundingClientRect()` of the button. We freeze the
  // computed (clamped) position once when the anchor changes — so
  // re-renders triggered by SSE board updates or async fetches that
  // change `items.length` no longer shift the menu.
  //
  // Closes on:
  //   - any outside click
  //   - Escape
  //   - clicking an item (after the action runs)
  //   - hovering a different submenu (the previous submenu collapses)
  //
  // Keyboard nav: ↑/↓ moves the highlight, → opens a submenu, ←
  // closes it, Enter / Space activates.

  import { onMount, tick, untrack } from "svelte";
  import { cardMenuStore } from "./card-menu-store.svelte.js";
  import type { MenuItem } from "./card-menu-types.js";

  // Pull state through derived getters so the component subscribes to
  // each field. (Reading store.state.foo inside the script block also
  // subscribes, but going through getters makes the dependency
  // explicit and lets us guard against null anchor in one place.)
  const open = $derived(cardMenuStore.state.open);
  const anchor = $derived(cardMenuStore.state.anchor);
  const items = $derived(cardMenuStore.state.items);

  let menuEl = $state<HTMLDivElement | null>(null);
  let openSubmenu = $state<number | null>(null);
  let highlight = $state<number>(-1);

  // Frozen position. Computed when `anchor` first changes after
  // an open. We snapshot via untrack on items so an async fetch that
  // appends "Assign ▸" later doesn't shift the menu mid-life.
  let position = $state<{ x: number; y: number }>({ x: 0, y: 0 });
  let lastAnchorKey = "";

  function freezePosition(): void {
    if (!anchor) return;
    const margin = 8;
    const w = 220;
    const itemCount = untrack(() => items.length);
    const h = Math.max(itemCount, 6) * 32 + 12;
    const x = Math.min(anchor.x, window.innerWidth - w - margin);
    const y = Math.min(anchor.y, window.innerHeight - h - margin);
    position = { x: Math.max(margin, x), y: Math.max(margin, y) };
  }

  function handleDocumentMousedown(event: MouseEvent) {
    if (!cardMenuStore.state.open) return;
    if (menuEl && !menuEl.contains(event.target as Node)) cardMenuStore.close();
  }

  function handleKey(event: KeyboardEvent) {
    if (!cardMenuStore.state.open) return;
    const visibleItems = items.filter((it) => !it.separator);
    if (event.key === "Escape") {
      event.preventDefault();
      if (openSubmenu !== null) {
        openSubmenu = null;
      } else {
        cardMenuStore.close();
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
        cardMenuStore.close();
      }
    } else {
      cardMenuStore.close();
    }
  }

  $effect(() => {
    if (open && anchor) {
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
    document.addEventListener("mousedown", handleDocumentMousedown, { capture: true });
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleDocumentMousedown, { capture: true });
      document.removeEventListener("keydown", handleKey);
    };
  });
</script>

{#if open && anchor}
  <div
    class="menu"
    bind:this={menuEl}
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
    /* --border does not exist in app.css: the declaration was invalid
       and the popover fell back to currentColor, i.e. a near-black
       1px frame in light mode and a white one in dark. */
    border: 1px solid var(--border-default);
    border-radius: 8px;
    box-shadow: var(--elev-floating);
    padding: 4px;
    outline: none;
    user-select: none;
  }
  /* The menu is focused programmatically on open; killing the UA ring
     is only allowed with a real replacement. */
  .menu:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 10px;
    background: transparent;
    border: 0;
    border-radius: 4px;
    color: inherit;
    cursor: pointer;
    text-align: left;
    font: inherit;
    font-size: 13px;
    line-height: 1.3;
  }
  .item:hover:not(.disabled),
  .item.active:not(.disabled) {
    background: var(--bg-hover);
  }
  .item.disabled {
    color: var(--text-subtle);
    cursor: not-allowed;
  }
  .item.danger {
    color: var(--danger);
  }
  .item.danger:hover:not(.disabled) {
    background: color-mix(in srgb, var(--danger) 8%, transparent);
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
    background: var(--border-default);
    margin: 4px 0;
  }
  .submenu {
    position: absolute;
    left: 100%;
    top: 0;
    min-width: 180px;
    background: var(--bg-surface);
    border: 1px solid var(--border-default);
    border-radius: 8px;
    box-shadow: var(--elev-floating);
    padding: 4px;
    margin-left: 4px;
  }
</style>
