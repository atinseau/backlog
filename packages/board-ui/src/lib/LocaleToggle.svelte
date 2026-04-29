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
    gap: 1px;
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
  }
  button:hover { background: var(--bg-surface); color: var(--text-primary); }
  button.active {
    background: var(--bg-surface);
    color: var(--accent);
  }
</style>
