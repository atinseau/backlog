<script lang="ts">
  import {
    fetchHooksStatus,
    installRepoHook,
    uninstallRepoHook,
    type HooksOverview,
    type HookStatus,
  } from "./api.js";
  import { t } from "./i18n.svelte.js";

  interface Props {
    embedded?: boolean;
    onClose: () => void;
    onChanged?: () => void;
  }

  let { embedded = false, onClose, onChanged }: Props = $props();

  let overview = $state<HooksOverview | null>(null);
  let loading = $state(true);
  let busy = $state<string | null>(null);
  let error = $state<string | null>(null);

  const installed = $derived(overview?.hooks.filter((hook) => hook.exists && hook.managed) ?? []);
  const missing = $derived(overview?.hooks.filter((hook) => Boolean(hook.git_dir) && !hook.exists) ?? []);
  const outdated = $derived(overview?.hooks.filter((hook) =>
    hook.exists && hook.managed && hook.points_to_backlog_bin && !hook.up_to_date,
  ) ?? []);
  const foreign = $derived(overview?.hooks.filter((hook) => hook.exists && !hook.managed) ?? []);

  function statusLabel(hook: HookStatus): { label: string; tone: "ok" | "warn" | "off" | "missing" } {
    if (!hook.git_dir) return { label: t("hooks.status.no_git"), tone: "missing" };
    if (!hook.exists) return { label: t("hooks.status.not_installed"), tone: "off" };
    if (hook.managed && hook.points_to_backlog_bin && hook.up_to_date) return { label: t("hooks.status.current"), tone: "ok" };
    if (hook.managed && hook.points_to_backlog_bin) return { label: t("hooks.status.outdated"), tone: "warn" };
    if (hook.exists && !hook.managed) return { label: t("hooks.status.foreign"), tone: "warn" };
    return { label: t("hooks.status.outdated"), tone: "warn" };
  }

  async function load() {
    loading = true;
    try {
      overview = await fetchHooksStatus();
      error = null;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }

  async function install(hook: HookStatus) {
    busy = hook.repo_id;
    try {
      await installRepoHook(hook.repo_id);
      await load();
      onChanged?.();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = null;
    }
  }

  async function uninstall(hook: HookStatus) {
    const ok = typeof window === "undefined" || window.confirm(t("hooks.uninstall_confirm"));
    if (!ok) return;
    busy = hook.repo_id;
    try {
      await uninstallRepoHook(hook.repo_id);
      await load();
      onChanged?.();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = null;
    }
  }

  async function installAll(targets: HookStatus[]) {
    if (targets.length === 0) return;
    busy = "__all__";
    try {
      for (const hook of targets) await installRepoHook(hook.repo_id);
      await load();
      onChanged?.();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = null;
    }
  }

  load();
</script>

{#snippet stat(label: string, value: number)}
  <div class="stat">
    <strong>{value}</strong>
    <span>{label}</span>
  </div>
{/snippet}

{#snippet body()}
  <header class="view-header">
    <div>
      <h2>{t("hooks_view.title")}</h2>
      <p>{t("hooks_view.subtitle")}</p>
    </div>
    <div class="header-actions">
      <button type="button" onclick={load} disabled={loading}>{loading ? "…" : t("common.refresh")}</button>
      {#if !embedded}<button class="close" onclick={onClose}>✕</button>{/if}
    </div>
  </header>

  {#if error}
    <div class="error">{error}</div>
  {/if}

  {#if loading}
    <div class="loading">…</div>
  {:else if overview}
    <section class="summary">
      {@render stat(t("hooks_view.installed"), installed.length)}
      {@render stat(t("hooks_view.outdated"), outdated.length)}
      {@render stat(t("hooks_view.missing"), missing.length)}
      {@render stat(t("hooks_view.foreign"), foreign.length)}
    </section>

    <section class="explain">
      <div>
        <h3>{t("hooks_view.why_title")}</h3>
        <p>{t("hooks_view.why_body")}</p>
      </div>
      <div class="commands">
        <code>backlog hooks status</code>
        <code>backlog hooks install</code>
        <code>backlog hooks disable</code>
        <code>backlog hooks uninstall</code>
      </div>
    </section>

    {#if overview.project_paused_until}
      <div class="pause">⏸ {t("hooks.paused_until", { until: overview.project_paused_until })}</div>
    {/if}

    {#if outdated.length > 0 || missing.length > 0}
      <div class="bulk">
        {#if outdated.length > 0}
          <button class="primary" type="button" onclick={() => installAll(outdated)} disabled={busy !== null}>
            {busy === "__all__" ? "…" : t("hooks.update_all_button")}
          </button>
        {/if}
        {#if missing.length > 0}
          <button type="button" onclick={() => installAll(missing)} disabled={busy !== null}>
            {busy === "__all__" ? "…" : t("hooks.install_missing_button")}
          </button>
        {/if}
      </div>
    {/if}

    <section class="table" aria-label={t("hooks_view.repositories")}>
      {#if overview.hooks.length === 0}
        <div class="empty">{t("hooks_view.empty")}</div>
      {:else}
        {#each overview.hooks as hook (hook.repo_id)}
          {@const status = statusLabel(hook)}
          <article class="row">
            <div class="main">
              <div class="title-row">
                <strong>{hook.repo_id}</strong>
                <span class="badge tone-{status.tone}">{status.label}</span>
              </div>
              <div class="details">
                {#if hook.repo_path}<span>{hook.repo_path}</span>{/if}
                {#if hook.hook_path}<span>{hook.hook_path}</span>{/if}
              </div>
            </div>
            <div class="versions">
              <span>{t("hooks_view.installed_version")}</span>
              <strong>{hook.installed_version ?? "—"}</strong>
              <span>{t("hooks_view.expected_version")}</span>
              <strong>{hook.expected_version}</strong>
            </div>
            <div class="actions">
              {#if hook.git_dir && (!hook.exists || (hook.managed && hook.points_to_backlog_bin && !hook.up_to_date))}
                <button class="primary" type="button" onclick={() => install(hook)} disabled={busy !== null}>
                  {busy === hook.repo_id ? "…" : (hook.exists ? t("hooks.update_button") : t("hooks.install_button"))}
                </button>
              {/if}
              {#if hook.exists && hook.managed}
                <button class="danger" type="button" onclick={() => uninstall(hook)} disabled={busy !== null}>
                  {busy === hook.repo_id ? "…" : t("hooks.uninstall_button")}
                </button>
              {/if}
            </div>
          </article>
        {/each}
      {/if}
    </section>
  {/if}
{/snippet}

{#if embedded}
  <div class="embedded">{@render body()}</div>
{:else}
  <div class="backdrop" onclick={onClose} role="presentation">
    <div
      class="modal"
      onclick={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal="true"
      tabindex={-1}
      onkeydown={(e) => { if (e.key === "Escape") onClose(); }}
    >
      {@render body()}
    </div>
  </div>
{/if}

<style>
  .embedded {
    height: 100%;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--bg-surface);
    color: var(--text-primary);
  }
  .backdrop {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--backdrop);
    z-index: 100;
  }
  .modal {
    width: min(1040px, 94vw);
    max-height: 88vh;
    border-radius: 8px;
    overflow: hidden;
    background: var(--bg-surface);
    color: var(--text-primary);
    box-shadow: var(--shadow-modal);
    display: flex;
    flex-direction: column;
  }
  .view-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border-default);
  }
  .view-header h2 {
    margin: 0;
    font-size: 20px;
  }
  .view-header p {
    margin: 4px 0 0;
    color: var(--text-muted);
    font-size: 13px;
  }
  .header-actions,
  .bulk,
  .actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  button {
    border: 1px solid var(--border-strong);
    border-radius: 5px;
    background: var(--bg-input);
    color: var(--text-primary);
    font: inherit;
    cursor: pointer;
    padding: 6px 10px;
  }
  button:disabled {
    opacity: 0.55;
    cursor: default;
  }
  .primary {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }
  .danger {
    color: var(--danger);
    border-color: color-mix(in srgb, var(--danger) 40%, var(--border-default));
  }
  .close {
    border: none;
    background: transparent;
    color: var(--text-secondary);
    font-size: 18px;
  }
  .error,
  .pause {
    margin: 12px 20px 0;
    border-radius: 6px;
    padding: 8px 10px;
    font-size: 12px;
  }
  .error {
    color: var(--danger);
    background: var(--danger-bg);
    border: 1px solid color-mix(in srgb, var(--danger) 35%, transparent);
  }
  .pause {
    color: var(--warning);
    background: var(--warning-bg);
    border: 1px solid color-mix(in srgb, var(--warning) 35%, transparent);
  }
  .loading,
  .empty {
    padding: 32px;
    color: var(--text-muted);
    text-align: center;
  }
  .summary {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 10px;
    padding: 16px 20px 10px;
  }
  .stat {
    border: 1px solid var(--border-default);
    border-radius: 7px;
    background: var(--bg-elevated);
    padding: 12px;
  }
  .stat strong {
    display: block;
    font-size: 24px;
  }
  .stat span {
    color: var(--text-muted);
    font-size: 12px;
  }
  .explain {
    margin: 0 20px 12px;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 16px;
    align-items: start;
    border: 1px solid var(--border-default);
    border-radius: 7px;
    background: var(--bg-muted);
    padding: 12px;
  }
  .explain h3 {
    margin: 0 0 6px;
    font-size: 14px;
  }
  .explain p {
    margin: 0;
    color: var(--text-secondary);
    font-size: 13px;
  }
  .commands {
    display: grid;
    gap: 5px;
  }
  code {
    border: 1px solid var(--border-subtle);
    border-radius: 4px;
    background: var(--bg-input);
    color: var(--text-primary);
    font-size: 11px;
    padding: 4px 6px;
    white-space: nowrap;
  }
  .bulk {
    padding: 0 20px 12px;
  }
  .table {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 0 20px 24px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    gap: 14px;
    align-items: center;
    border: 1px solid var(--border-default);
    border-radius: 7px;
    background: var(--bg-elevated);
    padding: 10px 12px;
  }
  .title-row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .title-row strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .badge {
    border-radius: 999px;
    padding: 2px 7px;
    font-size: 11px;
    flex-shrink: 0;
  }
  .tone-ok { color: var(--success); background: var(--success-bg); }
  .tone-warn { color: var(--warning); background: var(--warning-bg); }
  .tone-off { color: var(--text-muted); background: var(--bg-hover); }
  .tone-missing { color: var(--danger); background: var(--danger-bg); }
  .details {
    margin-top: 6px;
    display: grid;
    gap: 3px;
    color: var(--text-muted);
    font-family: ui-monospace, monospace;
    font-size: 11px;
  }
  .details span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .versions {
    display: grid;
    grid-template-columns: auto auto;
    gap: 3px 8px;
    align-items: baseline;
    font-size: 11px;
  }
  .versions span {
    color: var(--text-muted);
  }
  .versions strong {
    color: var(--text-primary);
  }
  @media (max-width: 900px) {
    .summary,
    .explain,
    .row {
      grid-template-columns: 1fr;
    }
    .actions {
      justify-content: flex-end;
    }
  }
</style>
