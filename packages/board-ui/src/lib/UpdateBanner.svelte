<script lang="ts">
  // In-app banner that surfaces Desktop update progress. Updates are
  // opt-in at every step: Backlog may discover an available version, but
  // download and install both require explicit button clicks.
  //
  // Status flow:
  //   idle (no banner)
  //   → checking (manual check only)
  //   → available (banner: "Update available" + Download button)
  //   → downloading (progress bar)
  //   → downloaded (banner: "Backlog X.Y.Z ready" + Restart button)
  //   → error (banner: dismissible warning)
  //
  // Mounted at the top of App.svelte, only renders when there's
  // something to show. Hidden in browser-served `backlog serve` (no
  // window.backlog bridge).
  import { onDestroy, onMount } from "svelte";
  import { t } from "./i18n.svelte.js";

  let status: UpdateStatus | null = $state(null);
  // After "not-available" we hide the banner after 4s — a manual check
  // that returns "you're up to date" should confirm and disappear, not
  // linger as a permanent stripe.
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  // User-dismissed states (errors, "up-to-date") so the banner doesn't
  // re-pop on every re-render.
  let dismissedKey: string | null = $state(null);

  function statusKey(s: UpdateStatus | null): string {
    if (!s) return "none";
    if (s.kind === "available" || s.kind === "downloaded" || s.kind === "not-available")
      return `${s.kind}:${s.version}`;
    if (s.kind === "error") return `error:${s.message}`;
    return s.kind;
  }

  $effect(() => {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    if (status?.kind === "not-available") {
      hideTimer = setTimeout(() => {
        if (status?.kind === "not-available") status = null;
      }, 4000);
    }
  });

  let unsubscribe: (() => void) | null = null;
  onMount(() => {
    if (typeof window === "undefined" || !window.backlog?.onUpdateStatus) return;
    // Replay the last known status so a banner that mounts mid-download
    // immediately reflects reality.
    void window.backlog.getUpdateStatus?.().then((s) => {
      if (s) status = s;
    });
    unsubscribe = window.backlog.onUpdateStatus((next) => {
      status = next;
    });
  });
  onDestroy(() => {
    unsubscribe?.();
    if (hideTimer) clearTimeout(hideTimer);
  });

  function dismiss() {
    dismissedKey = statusKey(status);
    status = null;
  }

  function formatBytes(n: number): string {
    if (!Number.isFinite(n) || n <= 0) return "—";
    const mb = n / 1024 / 1024;
    return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(n / 1024).toFixed(0)} KB`;
  }

  async function restart() {
    await window.backlog?.installUpdate();
  }

  async function download() {
    const next = await window.backlog?.downloadUpdate();
    if (next) status = next;
  }

  // Skip the banner entirely if the user dismissed this exact state
  // (e.g. they X'd out an error — don't keep nagging them on the same
  // error string).
  let visible = $derived(status !== null && statusKey(status) !== dismissedKey);
</script>

{#if visible && status}
  <div class="update-banner update-banner--{status.kind}" role="status" aria-live="polite">
    <div class="update-banner__icon" aria-hidden="true">
      {#if status.kind === "downloaded"}
        <span class="dot dot--ready"></span>
      {:else if status.kind === "error"}
        <span class="dot dot--error"></span>
      {:else if status.kind === "downloading" || status.kind === "checking"}
        <span class="spinner"></span>
      {:else}
        <span class="dot dot--info"></span>
      {/if}
    </div>

    <div class="update-banner__body">
      {#if status.kind === "checking"}
        <span class="update-banner__title">{t("update.checking")}</span>
      {:else if status.kind === "not-available"}
        <span class="update-banner__title">{t("update.up_to_date", { version: status.version })}</span>
      {:else if status.kind === "available"}
        <span class="update-banner__title">{t("update.available", { version: status.version })}</span>
        <span class="update-banner__detail">{t("update.available_detail")}</span>
      {:else if status.kind === "downloading"}
        <span class="update-banner__title">{t("update.downloading")}</span>
        <div class="update-banner__progress">
          <div class="update-banner__progress-bar" style:width="{Math.min(100, Math.max(0, status.percent)).toFixed(0)}%"></div>
        </div>
        <span class="update-banner__detail">
          {Math.round(status.percent)}% — {formatBytes(status.transferred)} / {formatBytes(status.total)}
        </span>
      {:else if status.kind === "downloaded"}
        <span class="update-banner__title">{t("update.ready", { version: status.version })}</span>
        <span class="update-banner__detail">{t("update.restart_to_install")}</span>
      {:else if status.kind === "error"}
        <!-- Header stays generic ("Mise à jour indisponible"); the
             specific cause goes in the detail line, with the raw
             error tucked into a tooltip for power users. The main.ts
             humanizeUpdateError() classifier turns electron-updater's
             stack-trace-y messages into one-sentence guidance. -->
        <span class="update-banner__title">{t("update.error")}</span>
        <span class="update-banner__detail" title={status.detail ?? status.message}>{status.message}</span>
      {/if}
    </div>

    <div class="update-banner__actions">
      {#if status.kind === "available"}
        <button class="btn-primary" onclick={download}>{t("update.download")}</button>
      {:else if status.kind === "downloaded"}
        <button class="btn-primary" onclick={restart}>{t("update.restart_now")}</button>
      {/if}
      {#if status.kind === "available" || status.kind === "error" || status.kind === "downloaded" || status.kind === "not-available"}
        <button class="btn-dismiss" onclick={dismiss} aria-label={t("update.dismiss")}>×</button>
      {/if}
    </div>
  </div>
{/if}

<style>
  .update-banner {
    position: sticky;
    top: 0;
    left: 0;
    right: 0;
    z-index: 10000;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 16px;
    background: color-mix(in srgb, var(--success, #4ade80) 14%, var(--bg-surface, #14171f));
    border-bottom: 1px solid color-mix(in srgb, var(--success, #4ade80) 45%, var(--border-default, #262a36));
    border-left: 3px solid var(--success, #4ade80);
    color: var(--text-primary, #e6e7eb);
    font-size: 13px;
    font-family: -apple-system, system-ui, sans-serif;
  }

  .update-banner--downloaded {
    background: color-mix(in srgb, var(--success, #4ade80) 18%, var(--bg-surface, #14171f));
    border-left-color: var(--success, #4ade80);
  }
  .update-banner--error {
    background: color-mix(in srgb, var(--danger, #ef4444) 12%, var(--bg-surface, #14171f));
    border-left-color: var(--danger, #ef4444);
  }
  .update-banner--not-available {
    background: color-mix(in srgb, var(--success, #4ade80) 10%, var(--bg-surface, #14171f));
    border-left-color: var(--success, #4ade80);
    opacity: 0.85;
  }

  .update-banner__icon {
    flex-shrink: 0;
    width: 14px;
    height: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    display: inline-block;
  }
  .dot--info { background: var(--success, #4ade80); }
  .dot--ready { background: var(--success, #4ade80); box-shadow: 0 0 8px rgba(74, 222, 128, 0.5); }
  .dot--error { background: var(--danger, #ef4444); }

  .spinner {
    width: 12px;
    height: 12px;
    border: 2px solid var(--border-default, #262a36);
    border-top-color: var(--success, #4ade80);
    border-radius: 50%;
    animation: update-spin 0.7s linear infinite;
  }

  @keyframes update-spin {
    to { transform: rotate(360deg); }
  }

  .update-banner__body {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .update-banner__title {
    font-weight: 600;
  }

  .update-banner__detail {
    color: var(--text-muted, #9ca3af);
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .update-banner__progress {
    width: 100%;
    max-width: 240px;
    height: 4px;
    background: var(--border-default, #262a36);
    border-radius: 999px;
    overflow: hidden;
    margin-top: 4px;
  }

  .update-banner__progress-bar {
    height: 100%;
    background: var(--success, #4ade80);
    transition: width 200ms ease-out;
  }

  .update-banner__actions {
    flex-shrink: 0;
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .btn-primary {
    background: var(--success, #4ade80);
    color: #0b0b0e;
    border: none;
    border-radius: 4px;
    padding: 6px 12px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }
  .btn-primary:hover {
    filter: brightness(1.1);
  }

  .btn-dismiss {
    background: transparent;
    border: none;
    color: var(--text-muted, #9ca3af);
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
    padding: 0 6px;
  }
  .btn-dismiss:hover {
    color: var(--text-primary, #e6e7eb);
  }
</style>
