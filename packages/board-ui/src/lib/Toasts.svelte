<script lang="ts" module>
  // Type exports must live in a module-level script in Svelte 5 —
  // svelte-check refuses `export type` from a regular `<script>`.
  export type ToastKind = "info" | "success" | "warning" | "error";
</script>

<script lang="ts">
  // Lightweight toast surface anchored bottom-right.
  //
  // Scope: notifications driven by run lifecycle transitions
  // (start / completion / failure / awaiting review). Other ephemeral
  // confirmations could plug in here later, but the API is intentionally
  // narrow — `push({kind, message})` and the component handles the rest.
  //
  // Toasts auto-dismiss after `DURATION_MS`, but the user can also
  // dismiss them manually via the × button. We keep them stacked
  // top-down so the newest one appears at the bottom (closest to the
  // anchor point, i.e. where the eye lands when something just happened).
  import { t } from "./i18n.svelte.js";

  interface Toast {
    id: number;
    kind: ToastKind;
    message: string;
  }

  // 5s feels long enough for the user to register "X started/finished"
  // without dwelling on the screen. Failures stay a bit longer so the
  // message is harder to miss.
  const DURATION_MS = 5000;
  const FAILURE_DURATION_MS = 8000;

  let toasts = $state<Toast[]>([]);
  let nextId = 1;

  export function push(kind: ToastKind, message: string): void {
    const id = nextId++;
    toasts = [...toasts, { id, kind, message }];
    const ttl = kind === "error" ? FAILURE_DURATION_MS : DURATION_MS;
    setTimeout(() => dismiss(id), ttl);
  }

  function dismiss(id: number): void {
    toasts = toasts.filter((toast) => toast.id !== id);
  }
</script>

<div class="toasts" role="status" aria-live="polite">
  {#each toasts as toast (toast.id)}
    <div class="toast toast-{toast.kind}">
      <span class="message">{toast.message}</span>
      <button
        class="dismiss"
        type="button"
        onclick={() => dismiss(toast.id)}
        aria-label={t("run.toast.dismiss")}
        title={t("run.toast.dismiss")}
      >×</button>
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    bottom: 16px;
    right: 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    z-index: 9000;
    pointer-events: none;
  }
  /* The kind used to be carried by a 3px coloured left rail. DESIGN.md
     allows exactly one such rail in the product — the card priority
     marker — so the kind moves onto the pale-surface / saturated-rule
     pair the system already uses for status badges. Same information,
     an authorised support, and the message text keeps saying it in
     words so nothing rides on colour alone.
     Elevation: a toast is *Floating*, not *Modal*. */
  .toast {
    pointer-events: auto;
    background: var(--toast-bg, var(--bg-surface));
    color: var(--text-primary);
    border: 1px solid var(--toast-accent, var(--accent));
    border-radius: 6px;
    box-shadow: var(--elev-floating);
    padding: 8px 10px;
    min-width: 240px;
    max-width: 360px;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    animation: toast-in 180ms ease-out;
  }
  .toast-info    { --toast-accent: var(--accent);  --toast-bg: var(--accent-bg); }
  .toast-success { --toast-accent: var(--success); --toast-bg: var(--success-bg); }
  .toast-warning { --toast-accent: var(--warning); --toast-bg: var(--warning-bg); }
  .toast-error   { --toast-accent: var(--danger);  --toast-bg: var(--danger-bg); }
  .message { flex: 1; min-width: 0; line-height: 1.35; }
  .dismiss {
    background: transparent;
    border: none;
    /* --text-muted grazes the floor on --danger-bg in light (4.43:1);
       --text-secondary clears every one of the four toast fills. */
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 16px;
    line-height: 1;
    padding: 0 4px;
    flex-shrink: 0;
    /* WCAG 2.5.8 floor — 24px, 28px under a coarse pointer. */
    min-width: var(--tap-size);
    min-height: var(--tap-size);
    border-radius: 4px;
  }
  .dismiss:hover { color: var(--text-primary); }

  @keyframes toast-in {
    from { transform: translateY(8px); opacity: 0; }
    to   { transform: translateY(0);   opacity: 1; }
  }
</style>
