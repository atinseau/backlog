<script lang="ts">
  import { t } from "./i18n.svelte.js";

  type View = "tickets" | "claims";

  interface Props {
    value: View;
    onChange: (next: View) => void;
  }

  let { value, onChange }: Props = $props();
</script>

<div class="toggle" role="radiogroup" aria-label={t("view_toggle.aria_label")}>
  <button
    class="tab"
    class:active={value === "tickets"}
    onclick={() => onChange("tickets")}
    aria-pressed={value === "tickets"}
  >
    {t("view_toggle.tickets")}
  </button>
  <button
    class="tab"
    class:active={value === "claims"}
    onclick={() => onChange("claims")}
    aria-pressed={value === "claims"}
  >
    {t("view_toggle.claims")}
  </button>
</div>

<style>
  .toggle {
    display: inline-flex;
    background: var(--bg-hover);
    border-radius: 6px;
    padding: 2px;
    gap: 1px;
  }
  .tab {
    background: transparent;
    border: none;
    padding: 4px 12px;
    cursor: pointer;
    font-size: 12px;
    color: var(--text-secondary);
    border-radius: 4px;
    /* WCAG 2.5.8 : 24×24 minimum, 28 sous pointeur grossier (app.css). */
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: var(--tap-size);
  }
  .tab:hover { color: var(--text-primary); }
  .tab.active {
    background: var(--bg-surface);
    color: var(--text-primary);
    box-shadow: var(--elev-rest);
  }
</style>
