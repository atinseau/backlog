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
    background: #f2f4f7;
    border: 1px solid #d0d5dd;
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
    color: #475467;
    border-radius: 3px;
    font-weight: 500;
    letter-spacing: 0.04em;
  }
  button:hover { background: white; color: #1d2939; }
  button.active {
    background: white;
    color: #1570ef;
  }
</style>
