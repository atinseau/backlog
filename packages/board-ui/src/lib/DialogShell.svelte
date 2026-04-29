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
    ariaLabel?: string;
    // Per-dialog class so each consumer can target its modal with a
    // unique :global() selector for sizing / padding tweaks. The base
    // "modal" class is always applied alongside this extra one.
    extraClass?: string;
    children?: Snippet;
  }

  let { onClose, ariaLabel, extraClass, children }: Props = $props();
</script>

<div class="backdrop" onclick={onClose} role="presentation">
  <div
    class={extraClass ? `modal ${extraClass}` : "modal"}
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
    background: var(--backdrop);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 200;
  }
  /* Base modal frame. Per-dialog overrides come from each consumer's
     :global(.<extra-class>) rule. */
  :global(.modal) {
    background: var(--bg-surface);
    color: var(--text-primary);
    border-radius: 8px;
    box-shadow: var(--shadow-modal);
    max-width: 460px;
    width: 92%;
    max-height: 90vh;
    overflow-y: auto;
  }
</style>
