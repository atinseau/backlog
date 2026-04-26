<script lang="ts">
  type View = "tickets" | "claims";

  interface Props {
    value: View;
    onChange: (next: View) => void;
  }

  let { value, onChange }: Props = $props();
</script>

<div class="toggle" role="radiogroup" aria-label="Vue du kanban">
  <button
    class="tab"
    class:active={value === "tickets"}
    onclick={() => onChange("tickets")}
    aria-pressed={value === "tickets"}
  >
    Tickets
  </button>
  <button
    class="tab"
    class:active={value === "claims"}
    onclick={() => onChange("claims")}
    aria-pressed={value === "claims"}
  >
    Claims
  </button>
</div>

<style>
  .toggle {
    display: inline-flex;
    background: #f2f4f7;
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
    color: #475467;
    border-radius: 4px;
  }
  .tab:hover { color: #1d2939; }
  .tab.active {
    background: white;
    color: #1d2939;
    box-shadow: 0 1px 2px rgba(16, 24, 40, 0.08);
  }
</style>
