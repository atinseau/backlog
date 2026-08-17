<script lang="ts">
  import { getLocale, setLocale, type Locale } from "./i18n.svelte.js";

  function pick(next: Locale) {
    setLocale(next);
  }

  const current = $derived(getLocale());
</script>

<div class="locale-toggle" role="group" aria-label="Language">
  <button
    type="button"
    class:active={current === "fr"}
    onclick={() => pick("fr")}
    aria-pressed={current === "fr"}
  >FR</button>
  <button
    type="button"
    class:active={current === "en"}
    onclick={() => pick("en")}
    aria-pressed={current === "en"}
  >EN</button>
</div>

<style>
  .locale-toggle {
    display: inline-flex;
    background: var(--bg-hover);
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    padding: 1px;
    /* --tap-gap widens to 4px under a coarse pointer: two adjacent
       targets need the gutter as much as the size. */
    gap: var(--tap-gap);
    font-size: 11px;
  }
  button {
    background: transparent;
    border: none;
    padding: 2px 8px;
    cursor: pointer;
    color: var(--text-secondary);
    border-radius: 3px;
    font-weight: 500;
    letter-spacing: 0.04em;
    /* WCAG 2.5.8 floor, 28px under a coarse pointer. */
    min-width: var(--tap-size);
    min-height: var(--tap-size);
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  button:hover { background: var(--bg-surface); color: var(--text-primary); }
  button.active {
    background: var(--bg-surface);
    color: var(--accent);
  }
</style>
