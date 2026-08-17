<script lang="ts">
  // Three-way theme switch — same visual style as LocaleToggle for
  // consistency. Auto follows the OS appearance, the other two pin
  // light or dark explicitly. The choice persists to localStorage via
  // theme.svelte.ts.
  import { themeMode, setThemeMode, type ThemeMode } from "./theme.svelte.js";
  import { t } from "./i18n.svelte.js";

  const current = $derived(themeMode());

  const OPTIONS: { value: ThemeMode; label: () => string; symbol: string }[] = [
    { value: "auto", label: () => t("theme.auto"), symbol: "◐" },
    { value: "light", label: () => t("theme.light"), symbol: "☀" },
    { value: "dark", label: () => t("theme.dark"), symbol: "☾" },
  ];
</script>

<div class="theme-toggle" role="radiogroup" aria-label={t("theme.label")}>
  {#each OPTIONS as opt (opt.value)}
    <button
      type="button"
      class:active={current === opt.value}
      onclick={() => setThemeMode(opt.value)}
      role="radio"
      aria-checked={current === opt.value}
      title={opt.label()}
      aria-label={opt.label()}
    >
      <span class="symbol">{opt.symbol}</span>
    </button>
  {/each}
</div>

<style>
  .theme-toggle {
    display: inline-flex;
    background: var(--bg-hover);
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    padding: 1px;
    /* --tap-gap widens to 4px under a coarse pointer. */
    gap: var(--tap-gap);
    font-size: 12px;
  }
  button {
    background: transparent;
    border: none;
    padding: 2px 6px;
    cursor: pointer;
    color: var(--text-secondary);
    border-radius: 3px;
    line-height: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    /* WCAG 2.5.8 floor, 28px under a coarse pointer. */
    min-width: var(--tap-size);
    min-height: var(--tap-size);
  }
  button:hover { background: var(--bg-surface); color: var(--text-primary); }
  button.active {
    background: var(--bg-surface);
    color: var(--accent);
  }
  .symbol {
    font-size: 13px;
  }
</style>
