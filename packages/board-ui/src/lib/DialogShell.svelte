<script module lang="ts">
  // ── Focus trap ────────────────────────────────────────────────────
  // WCAG 2.4.3 (focus order) and 2.4.7 / 2.1.2. Every dialog on this
  // board declared role="dialog" + aria-modal="true" + tabindex={-1},
  // but nothing ever called .focus() and nothing held Tab inside: the
  // keyboard walked straight out of the dialog and onto the page behind
  // the backdrop — visually masked, still reachable, still operable.
  //
  // Written once, here, and exported as an action because six of the
  // ten dialogs predate DialogShell and still render their own
  // backdrop (CreateTaskDialog, CreateSubTaskDialog, TaskDetailDialog,
  // SplitDialog, ClaimDialog, ApiKeysDialog). They get the identical
  // behaviour with `use:focusTrap` instead of a copied implementation.
  const FOCUSABLE = [
    "a[href]",
    "area[href]",
    "button:not([disabled])",
    'input:not([disabled]):not([type="hidden"])',
    "select:not([disabled])",
    "textarea:not([disabled])",
    "iframe",
    '[contenteditable="true"]',
    '[tabindex]:not([tabindex="-1"])',
  ].join(",");

  // getClientRects() is the cheap "is it actually rendered?" test: it
  // drops display:none / hidden branches that querySelectorAll keeps.
  function focusablesWithin(root: HTMLElement): HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (el) => el.getClientRects().length > 0,
    );
  }

  export function focusTrap(node: HTMLElement) {
    const previous = document.activeElement as HTMLElement | null;
    let cancelled = false;

    // Two microtask hops on purpose. Five dialogs autofocus their own
    // first control with `queueMicrotask(() => node.focus())` inside a
    // `use:` action (CreateTaskDialog's description, StartPromptDialog's
    // Start button, …). Waiting a hop longer than they do lets their
    // choice win; we only step in when nothing inside the dialog holds
    // focus, so there is never a double focus nor a stolen one.
    queueMicrotask(() =>
      queueMicrotask(() => {
        if (cancelled || !node.isConnected) return;
        if (node.contains(document.activeElement)) return;
        (focusablesWithin(node)[0] ?? node).focus();
      }),
    );

    function onKeydown(event: KeyboardEvent) {
      if (event.key !== "Tab") return;
      const items = focusablesWithin(node);
      if (items.length === 0) {
        // Nothing to tab to: park focus on the dialog itself rather
        // than letting it escape to the page behind the backdrop.
        event.preventDefault();
        node.focus();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      const inside = active instanceof HTMLElement && active !== node && node.contains(active);
      if (event.shiftKey) {
        if (!inside || active === first) {
          event.preventDefault();
          last.focus();
        }
      } else if (!inside || active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    node.addEventListener("keydown", onKeydown);

    return {
      destroy() {
        cancelled = true;
        node.removeEventListener("keydown", onKeydown);
        // Hand focus back to whatever opened the dialog, so closing
        // returns the keyboard to the card or button it came from
        // instead of dumping it on <body>.
        if (previous?.isConnected && typeof previous.focus === "function") {
          previous.focus();
        }
      },
    };
  }
</script>

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
    use:focusTrap
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
    /* dvh so a mobile URL bar can't push the footer out of reach; the
       vh line stays as the fallback for engines without dvh. */
    max-height: 90vh;
    max-height: 90dvh;
    overflow-y: auto;
  }
</style>
