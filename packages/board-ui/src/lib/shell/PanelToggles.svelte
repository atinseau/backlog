<script lang="ts">
  // Three Xcode-style toggle buttons for the left, bottom, and right
  // panels. Each shows a small rectangle with the corresponding edge
  // permanently marked; the active state only changes emphasis.
  import { t } from "../i18n.svelte.js";

  interface Props {
    leftOpen: boolean;
    bottomOpen: boolean;
    rightOpen: boolean;
    onToggleLeft: () => void;
    onToggleBottom: () => void;
    onToggleRight: () => void;
    // Narrow shell: keep only the navigator toggle. The console and the
    // inspector are secondary at that width, and the three of them cost
    // ~140px of a 390px topbar. The navigator one can never be dropped —
    // it is the only way back to Claims, Git, Agents and settings once
    // the panel has collapsed.
    onlyNavigator?: boolean;
  }

  let {
    leftOpen,
    bottomOpen,
    rightOpen,
    onToggleLeft,
    onToggleBottom,
    onToggleRight,
    onlyNavigator = false,
  }: Props = $props();
</script>

<div class="toggles">
  <button
    class="toggle"
    class:active={leftOpen}
    onclick={onToggleLeft}
    title={leftOpen ? t("shell.hide_navigator") : t("shell.show_navigator")}
    aria-label={t("shell.toggle_navigator")}
    aria-pressed={leftOpen}
  >
    <svg width="18" height="14" viewBox="0 0 18 14" fill="none">
      <rect x="0.5" y="0.5" width="17" height="13" rx="2" stroke="currentColor" />
      <rect class="pane-marker" x="0.5" y="0.5" width="6" height="13" fill="currentColor" />
    </svg>
  </button>
  {#if !onlyNavigator}
  <button
    class="toggle"
    class:active={bottomOpen}
    onclick={onToggleBottom}
    title={bottomOpen ? t("shell.hide_console") : t("shell.show_console")}
    aria-label={t("shell.toggle_console")}
    aria-pressed={bottomOpen}
  >
    <svg width="18" height="14" viewBox="0 0 18 14" fill="none">
      <rect x="0.5" y="0.5" width="17" height="13" rx="2" stroke="currentColor" />
      <rect class="pane-marker" x="0.5" y="8.5" width="17" height="5" fill="currentColor" />
    </svg>
  </button>
  <button
    class="toggle"
    class:active={rightOpen}
    onclick={onToggleRight}
    title={rightOpen ? t("shell.hide_inspector") : t("shell.show_inspector")}
    aria-label={t("shell.toggle_inspector")}
    aria-pressed={rightOpen}
  >
    <svg width="18" height="14" viewBox="0 0 18 14" fill="none">
      <rect x="0.5" y="0.5" width="17" height="13" rx="2" stroke="currentColor" />
      <rect class="pane-marker" x="11.5" y="0.5" width="6" height="13" fill="currentColor" />
    </svg>
  </button>
  {/if}
</div>

<style>
  .toggles {
    display: inline-flex;
    align-items: center;
    /* Deux cibles conformes collées l'une à l'autre restent un raté :
       --tap-gap passe de 2px à 4px sous pointeur grossier (app.css). */
    gap: var(--tap-gap);
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    padding: 2px;
    background: var(--bg-muted);
  }
  .toggle {
    background: transparent;
    border: none;
    border-radius: 4px;
    padding: 5px 6px;
    /* WCAG 2.5.8 : 24×24 minimum en boîte de bordure, 28×28 sous pointeur
       grossier. Ces trois boutons sont l'unique organe d'ouverture des
       tiroirs en mode compact — ils doivent être les plus fiables au doigt
       de toute l'interface. --tap-size porte la bascule (app.css). */
    min-width: var(--tap-size);
    min-height: var(--tap-size);
    cursor: pointer;
    color: var(--text-subtle);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    line-height: 0;
    transition: background 120ms ease, color 120ms ease;
  }
  .toggle :global(.pane-marker) {
    opacity: 0.4;
  }
  .toggle:hover {
    background: var(--bg-active);
    color: var(--text-secondary);
  }
  .toggle.active {
    color: var(--accent);
  }
  .toggle.active :global(.pane-marker) {
    opacity: 1;
  }
  .toggle.active:hover {
    background: var(--accent-bg);
  }
</style>
