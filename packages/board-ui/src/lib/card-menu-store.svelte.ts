// Single global card-menu state. Hoisted out of Card.svelte so the
// menu has exactly ONE instance for the whole app instead of one per
// card. Three benefits:
//
// 1. Only one menu can be open at a time — no race when the user
//    clicks a different card's kebab while another is open.
// 2. The menu lives outside every card's subtree, so no ancestor
//    transform from svelte-dnd-action's FLIP animation can shift it
//    or make it disappear. (The earlier per-card portal hack tried
//    to escape this from inside the article — fragile because Svelte
//    actions and transform timing don't always cooperate.)
// 3. The menu's render lives at App-shell level, so `position: fixed`
//    is genuinely fixed-to-viewport.
//
// Cards call `cardMenuStore.openAt({ x, y, items })` from their kebab
// click handler. App.svelte renders a single `<CardMenu>` bound to
// `cardMenuStore`. When the user clicks outside, picks an item, or
// hits Escape, `cardMenuStore.close()` runs.
//
// State exported as a plain object with $state-rune backed fields so
// any consumer that reads them subscribes correctly.

import type { MenuItem } from "./card-menu-types.js";

interface CardMenuState {
  open: boolean;
  anchor: { x: number; y: number } | null;
  items: MenuItem[];
}

function createStore() {
  const state = $state<CardMenuState>({
    open: false,
    anchor: null,
    items: [],
  });

  function openAt(opts: { x: number; y: number; items: MenuItem[] }) {
    state.anchor = { x: opts.x, y: opts.y };
    state.items = opts.items;
    state.open = true;
  }

  function close() {
    state.open = false;
    // Clear items only after the menu has unmounted so the close
    // transition (if any) still has access to the labels. Anchor stays
    // — re-opening at the same kebab would compute the same anchor,
    // and clearing it could trigger a "no anchor" guard on render.
    state.items = [];
  }

  return {
    get state() {
      return state;
    },
    openAt,
    close,
  };
}

export const cardMenuStore = createStore();
