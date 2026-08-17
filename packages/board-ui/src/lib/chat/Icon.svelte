<script lang="ts">
  // One drawn icon set for the chat, in the geometry the board already uses:
  // a 14×14 box, currentColor, no stroke-width drift between glyphs. It exists
  // because the drawer was leaning on ⏸ ⏹ ↺ ✕ ⋯ ✓ ⚠ 🔒 — text glyphs whose
  // weight, baseline and colour come from the font, not from us.
  export type IconName =
    | "plus"
    | "close"
    | "trash"
    | "pause"
    | "stop"
    | "send"
    | "spinner"
    | "check"
    | "alert"
    | "lock"
    | "copy"
    | "edit"
    | "chevron"
    | "history";

  interface Props {
    name: IconName;
    size?: number;
    title?: string;
  }

  let { name, size = 14, title }: Props = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 14 14"
  fill="none"
  stroke="currentColor"
  stroke-width="1.4"
  stroke-linecap="round"
  stroke-linejoin="round"
  class:spin={name === "spinner"}
  aria-hidden={title ? undefined : "true"}
  role={title ? "img" : undefined}
  aria-label={title}
>
  {#if title}<title>{title}</title>{/if}
  {#if name === "plus"}
    <path d="M7 3v8M3 7h8" />
  {:else if name === "close"}
    <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" />
  {:else if name === "trash"}
    <path d="M2.5 4h9M5.5 4V2.8h3V4M4 4l.5 7.2h5L10 4M6 6v3.5M8 6v3.5" />
  {:else if name === "pause"}
    <path d="M5 3v8M9 3v8" />
  {:else if name === "stop"}
    <rect x="3.2" y="3.2" width="7.6" height="7.6" rx="1.4" />
  {:else if name === "send"}
    <path d="M7 11V3M3.6 6.4L7 3l3.4 3.4" />
  {:else if name === "spinner"}
    <path d="M7 1.8a5.2 5.2 0 1 1-5.2 5.2" />
  {:else if name === "check"}
    <path d="M3 7.4l2.6 2.6L11 4.4" />
  {:else if name === "alert"}
    <path d="M7 2.6l5 8.8H2l5-8.8ZM7 6v2.2M7 9.8v.01" />
  {:else if name === "lock"}
    <rect x="3" y="6.2" width="8" height="5.2" rx="1.2" />
    <path d="M5 6.2V4.8a2 2 0 0 1 4 0v1.4" />
  {:else if name === "copy"}
    <rect x="5" y="5" width="6.5" height="6.5" rx="1.2" />
    <path d="M9 5V3.7a1.2 1.2 0 0 0-1.2-1.2H3.7A1.2 1.2 0 0 0 2.5 3.7V8a1.2 1.2 0 0 0 1.2 1.2H5" />
  {:else if name === "edit"}
    <path d="M9.4 2.6l2 2L5.2 10.8 2.6 11.4l.6-2.6 6.2-6.2Z" />
  {:else if name === "chevron"}
    <path d="M5 3.5L8.5 7 5 10.5" />
  {:else if name === "history"}
    <path d="M7 4v3.2l2.2 1.3" />
    <path d="M1.9 7a5.1 5.1 0 1 0 1.5-3.6" />
    <path d="M1.8 2.2v2.4h2.4" />
  {/if}
</svg>

<style>
  svg {
    display: block;
    flex-shrink: 0;
  }

  /* The one place motion is authored in this component: a request in flight.
     Everything else changes state without moving. */
  .spin {
    animation: spin 900ms linear infinite;
    transform-origin: center;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .spin {
      animation: none;
      opacity: 0.6;
    }
  }
</style>
