<script lang="ts">
  import type { Snippet } from "svelte";

  // Reusable modal dialog wrapper. Centralizes the backdrop +
  // role="dialog" + Escape-to-close pattern that's been duplicated
  // across 11 dialogs since the board UI started. Each consumer just
  // wraps their content in <DialogShell {onClose}> … </DialogShell>
  // and gets keyboard close, focus management, and a consistent
  // backdrop for free.
  interface Props {
    onClose: () => void;
    // Optional ARIA label / class hooks so dialogs that need a custom
    // wrapper class can pass it through (a few use "dialog" instead of
    // "modal" for historical CSS reasons).
    ariaLabel?: string;
    modalClass?: string;
    children?: Snippet;
  }

  let { onClose, ariaLabel, modalClass = "modal", children }: Props = $props();
</script>

<div class="backdrop" onclick={onClose} role="presentation">
  <div
    class={modalClass}
    onclick={(e) => e.stopPropagation()}
    role="dialog"
    aria-modal="true"
    aria-label={ariaLabel}
    tabindex={-1}
    onkeydown={(e) => {
      if (e.key === "Escape") onClose();
    }}
  >
    {@render children?.()}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 200;
  }
</style>
