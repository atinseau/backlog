<script lang="ts">
  import { t } from "./i18n.svelte.js";

  interface Props {
    expiresAt: string;
    expectedFinishAt?: string | null;
    blocking?: boolean;
  }

  let { expiresAt, expectedFinishAt = null, blocking = false }: Props = $props();

  let now = $state(Date.now());

  $effect(() => {
    const interval = setInterval(() => {
      now = Date.now();
    }, 1000);
    return () => clearInterval(interval);
  });

  const target = $derived(expectedFinishAt ?? expiresAt);
  const remainingMs = $derived(new Date(target).getTime() - now);
  const overdue = $derived(
    remainingMs <= 0 || (expectedFinishAt !== null && new Date(expectedFinishAt).getTime() < now),
  );

  function formatRemaining(ms: number): string {
    const seconds = Math.max(0, Math.ceil(ms / 1000));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h${minutes % 60 > 0 ? ` ${minutes % 60}m` : ""}`;
  }
</script>

{#if overdue}
  <span class="badge overdue" title={t("retry_badge.overdue_hint")}>
    ⏱ {t("retry_badge.overdue")}
  </span>
{:else}
  <span
    class="badge {blocking ? 'blocking' : 'active'}"
    title={t("retry_badge.free_in", { time: formatRemaining(remainingMs) })}
  >
    {blocking ? "🔒" : "▶"} {formatRemaining(remainingMs)}
  </span>
{/if}

<style>
  .badge {
    /* 11px, not 10px: 10px is reserved for spaced uppercase labels. */
    font-size: 11px;
    padding: 1px 6px;
    border-radius: 3px;
    font-weight: 500;
  }
  .active   { background: var(--success-bg); color: var(--success); }
  .blocking { background: var(--warning-bg); color: var(--warning); }
  .overdue  { background: var(--danger-bg); color: var(--danger); }
</style>
