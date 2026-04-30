// Types for CardMenu.svelte. Lives in its own .ts file because Svelte 5
// only allows value/type exports from `<script context="module">`, and
// the MenuItem interface is consumed by both Card.svelte (the trigger)
// and CardMenu.svelte (the renderer). Pulling it out here keeps the
// component file focused on rendering logic.

export interface MenuItem {
  label: string;
  icon?: string;
  onSelect?: () => void | Promise<void>;
  /** Nested items rendered when this item is hovered / arrow-righted. */
  submenu?: MenuItem[];
  /** Renders the row in red — used for Delete and other destructive ops. */
  danger?: boolean;
  disabled?: boolean;
  /** When true, the item renders as a horizontal divider instead of a row. */
  separator?: boolean;
}
