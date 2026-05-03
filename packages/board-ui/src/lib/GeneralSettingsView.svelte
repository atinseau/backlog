<script lang="ts">
  // General app settings — preferences that aren't tied to a specific
  // project: appearance, board layout, notifications, CLI
  // info, onboarding reset, and About. Project-scoped settings (API
  // keys, chat history, project info) live in the left-panel
  // Paramètres section since they read/write the active project.
  import LocaleToggle from "./LocaleToggle.svelte";
  import ThemeToggle from "./ThemeToggle.svelte";
  import { t } from "./i18n.svelte.js";
  import {
    getShowReviewColumn, setShowReviewColumn,
    getNotifyOnRunComplete, setNotifyOnRunComplete,
    resetOnboarding,
    resetAllLocalSettings,
  } from "./settings.svelte.js";
  import { fetchAgents, fetchHealth, fetchProject, setReviewConfig, updateBacklogCli, type HealthResponse } from "./api.js";
  import type { AgentSummary } from "./types.js";

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();

  const showReview = $derived(getShowReviewColumn());
  const notifyRuns = $derived(getNotifyOnRunComplete());

  let health = $state<HealthResponse | null>(null);
  const desktopVersion = $derived(health?.app_version ?? health?.version ?? "—");
  const cliVersion = $derived(health?.cli?.version ?? null);
  const cliOutdated = $derived(Boolean(cliVersion && desktopVersion !== "—" && cliVersion !== desktopVersion));
  const cliInstallCommand = $derived(health?.cli?.update_command ?? "npm install -g backlog");
  let cliActionBusy = $state(false);
  let cliActionError = $state<string | null>(null);
  let cliActionMessage = $state<string | null>(null);

  // Project-scoped review settings (auto-reviewer agent). Loaded
  // alongside the agents catalog so the dropdown can render labels.
  let reviewerAgentId = $state<string>("");
  let agentOptions = $state<AgentSummary[]>([]);
  let reviewerSaving = $state(false);

  async function load() {
    try { health = await fetchHealth({ refreshCli: true }); } catch { /* best-effort */ }
    try {
      const [agents, project] = await Promise.all([
        fetchAgents().catch(() => []),
        fetchProject().catch(() => null),
      ]);
      agentOptions = agents.filter(
        (a) => a.provider === "claude" || a.provider === "codex" || a.provider === "custom",
      );
      const review = (project as unknown as { review?: { show_review_column?: boolean; auto_reviewer_agent_id?: string } } | null)?.review;
      if (review?.show_review_column) {
        setShowReviewColumn(review.show_review_column);
      } else if (getShowReviewColumn()) {
        await setReviewConfig({ show_review_column: true });
      } else if (review?.show_review_column !== undefined) {
        setShowReviewColumn(false);
      }
      reviewerAgentId = review?.auto_reviewer_agent_id ?? "";
    } catch {
      /* best-effort */
    }
  }

  async function saveReviewer(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value;
    reviewerSaving = true;
    try {
      await setReviewConfig({ auto_reviewer_agent_id: value === "" ? null : value });
      reviewerAgentId = value;
    } catch {
      /* surface via toast later — for now silent */
    } finally {
      reviewerSaving = false;
    }
  }

  function copy(text: string): void {
    navigator.clipboard?.writeText(text).catch(() => undefined);
  }

  async function updateCliFromSettings(): Promise<void> {
    cliActionBusy = true;
    cliActionError = null;
    cliActionMessage = null;
    try {
      const result = await updateBacklogCli();
      health = health
        ? { ...health, cli: result.status }
        : { ok: true, project: "", version: desktopVersion, app_version: desktopVersion, server_version: desktopVersion, cli: result.status };
      cliActionMessage = t("settings.cli.update_success", {
        version: result.status.version ?? t("settings.cli.unknown_version"),
      });
      health = await fetchHealth({ refreshCli: true });
    } catch (error) {
      cliActionError = error instanceof Error ? error.message : String(error);
      try { health = await fetchHealth({ refreshCli: true }); } catch { /* best-effort */ }
    } finally {
      cliActionBusy = false;
    }
  }

  async function toggleReview(event: Event) {
    const value = (event.currentTarget as HTMLInputElement).checked;
    setShowReviewColumn(value);
    reviewerSaving = true;
    try {
      await setReviewConfig({ show_review_column: value });
    } catch {
      setShowReviewColumn(!value);
    } finally {
      reviewerSaving = false;
    }
  }
  function toggleNotify(event: Event) {
    const value = (event.currentTarget as HTMLInputElement).checked;
    setNotifyOnRunComplete(value);
    if (value && typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission().catch(() => undefined);
    }
  }
  function resetConfirm() {
    if (confirm(t("settings.reset.confirm"))) {
      resetAllLocalSettings();
    }
  }

  load();
</script>

<div class="backdrop" onclick={onClose} role="presentation">
  <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex={-1} onkeydown={(e) => { if (e.key === "Escape") onClose(); }}>
    <header>
      <h2>{t("settings.title")}</h2>
      <button class="close" onclick={onClose}>✕</button>
    </header>

    <div class="content">
      <!-- Apparence -->
      <section class="block">
        <h3>{t("settings.appearance.title")}</h3>
        <p class="hint">{t("settings.appearance.hint")}</p>
        <div class="row">
          <span class="setting-label">{t("theme.label")}</span>
          <ThemeToggle />
        </div>
        <div class="row">
          <span class="setting-label">{t("settings.locale")}</span>
          <LocaleToggle />
        </div>
      </section>

      <!-- Tableau -->
      <section class="block">
        <h3>{t("settings.board.title")}</h3>
        <p class="hint">{t("settings.board.hint")}</p>
        <label class="toggle">
          <input type="checkbox" checked={showReview} onchange={toggleReview} />
          <span>
            <span class="toggle-label">{t("settings.board.show_review")}</span>
            <span class="toggle-desc">{t("settings.board.show_review_desc")}</span>
          </span>
        </label>

        {#if showReview}
          <div class="review-pick">
            <label class="reviewer-label">
              {t("settings.board.review_agent")}
              <select value={reviewerAgentId} disabled={reviewerSaving} onchange={saveReviewer}>
                <option value="">{t("settings.board.review_agent_manual")}</option>
                {#each agentOptions as agent (agent.id)}
                  <option value={agent.id} disabled={agent.needs_api_key}>
                    {agent.id}{agent.needs_api_key ? " 🔑" : ""}
                  </option>
                {/each}
              </select>
            </label>
            <p class="hint sub">{t("settings.board.review_agent_hint")}</p>
          </div>
        {/if}
      </section>

      <!-- Notifications -->
      <section class="block">
        <h3>{t("settings.notifications.title")}</h3>
        <p class="hint">{t("settings.notifications.hint")}</p>
        <label class="toggle">
          <input type="checkbox" checked={notifyRuns} onchange={toggleNotify} />
          <span>
            <span class="toggle-label">{t("settings.notifications.run_complete")}</span>
            <span class="toggle-desc">{t("settings.notifications.run_complete_desc")}</span>
          </span>
        </label>
      </section>

      <!-- CLI -->
      <section class="block">
        <h3>{t("settings.cli.title")}</h3>
        <p class="hint">{t("settings.cli.hint")}</p>
        <div class="info-grid">
          <div><span class="info-label">{t("settings.cli.desktop_version")}</span><strong>{desktopVersion}</strong></div>
          <div>
            <span class="info-label">{t("settings.cli.installed_version")}</span>
            <strong class:warn={cliOutdated}>
              {#if health?.cli?.available}
                {cliVersion ?? t("settings.cli.unknown_version")}
              {:else if health}
                {t("settings.cli.not_found")}
              {:else}
                —
              {/if}
            </strong>
          </div>
          {#if health?.cli?.path}
            <div class="full">
              <span class="info-label">{t("settings.cli.installed_path")}</span>
              <code class="path-code">{health.cli.path}</code>
            </div>
          {/if}
          <div><span class="info-label">{t("settings.cli.npm")}</span><a href="https://www.npmjs.com/package/backlog" target="_blank" rel="noopener noreferrer">backlog ↗</a></div>
        </div>
        {#if cliOutdated}
          <p class="version-warning">{t("settings.cli.outdated", { installed: cliVersion ?? "—", current: desktopVersion })}</p>
        {:else if health?.cli?.available}
          <p class="version-ok">{t("settings.cli.current")}</p>
        {:else if health}
          <p class="version-warning">{t("settings.cli.install_hint")}</p>
        {/if}
        {#if health}
          <div class="cli-actions">
            <button
              class="primary-action"
              type="button"
              onclick={updateCliFromSettings}
              disabled={cliActionBusy}
            >
              {#if cliActionBusy}
                {t("settings.cli.updating_button")}
              {:else if health.cli?.available}
                {t("settings.cli.update_button")}
              {:else}
                {t("settings.cli.install_button")}
              {/if}
            </button>
            <span class="hint">{t("settings.cli.auto_update_hint", { command: cliInstallCommand })}</span>
          </div>
        {/if}
        {#if cliActionMessage}
          <p class="version-ok">{cliActionMessage}</p>
        {/if}
        {#if cliActionError}
          <p class="version-warning">{t("settings.cli.update_failed", { error: cliActionError })}</p>
        {/if}
        <div class="cli-block">
          <div class="cli-row">
            <code>{cliInstallCommand}</code>
            <button class="copy" onclick={() => copy(cliInstallCommand)} title={t("settings.copy")}>⎘</button>
          </div>
          <div class="cli-row">
            <code>backlog --help</code>
            <button class="copy" onclick={() => copy("backlog --help")} title={t("settings.copy")}>⎘</button>
          </div>
        </div>
      </section>

      <!-- Onboarding -->
      <section class="block">
        <h3>{t("settings.onboarding.title")}</h3>
        <p class="hint">{t("settings.onboarding.hint")}</p>
        <button class="ghost" onclick={resetOnboarding}>{t("settings.onboarding.reset")}</button>
      </section>

      <!-- Reset -->
      <section class="block danger">
        <h3>{t("settings.reset.title")}</h3>
        <p class="hint">{t("settings.reset.hint")}</p>
        <button class="ghost danger-btn" onclick={resetConfirm}>{t("settings.reset.button")}</button>
      </section>

      <!-- About -->
      <section class="block">
        <h3>{t("settings.about.title")}</h3>
        <div class="info-grid">
          <div><span class="info-label">Backlog</span><strong>v{desktopVersion}</strong></div>
          <div><span class="info-label">{t("settings.about.license")}</span><strong>Apache-2.0</strong></div>
          <div class="full"><a href="https://github.com/osmove/backlog" target="_blank" rel="noopener noreferrer">github.com/osmove/backlog ↗</a></div>
          <div class="full"><a href="https://github.com/osmove/backlog/issues" target="_blank" rel="noopener noreferrer">{t("settings.about.report_issue")} ↗</a></div>
        </div>
      </section>
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed; inset: 0;
    background: var(--backdrop);
    display: flex; align-items: center; justify-content: center;
    z-index: 100;
  }
  .modal {
    background: var(--bg-surface);
    color: var(--text-primary);
    border-radius: 8px;
    box-shadow: var(--shadow-modal);
    max-width: 640px; width: 92%;
    max-height: 85vh;
    display: flex; flex-direction: column; overflow: hidden;
  }
  header {
    padding: 16px 20px;
    border-bottom: 1px solid var(--border-default);
    display: flex; align-items: center; justify-content: space-between;
  }
  h2 { margin: 0; font-size: 16px; }
  .close { background: transparent; border: none; font-size: 18px; cursor: pointer; color: var(--text-secondary); }
  .content {
    overflow-y: auto;
    padding: 16px 20px 32px;
    display: flex; flex-direction: column; gap: 20px;
  }
  .block {
    display: flex; flex-direction: column; gap: 8px;
    padding-bottom: 16px;
    border-bottom: 1px solid var(--border-subtle);
  }
  .block:last-child { border-bottom: none; }
  .block.danger { border-color: var(--danger-bg); }
  h3 {
    margin: 0; font-size: 13px; font-weight: 600;
    color: var(--text-body);
    text-transform: uppercase; letter-spacing: 0.04em;
  }
  .hint { margin: 0; font-size: 12px; color: var(--text-muted); line-height: 1.45; }
  .row {
    display: flex; align-items: center; justify-content: space-between;
    gap: 12px; padding: 6px 0;
  }
  .setting-label { font-size: 13px; color: var(--text-body); }
  .toggle {
    display: flex; align-items: flex-start; gap: 10px;
    cursor: pointer; padding: 6px 0;
  }
  .toggle input[type="checkbox"] {
    width: 16px; height: 16px; margin-top: 2px;
    accent-color: var(--accent); flex-shrink: 0;
  }
  .toggle-label { display: block; font-size: 13px; color: var(--text-primary); }
  .toggle-desc { display: block; font-size: 12px; color: var(--text-muted); margin-top: 2px; }
  .review-pick {
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px dashed var(--border-subtle);
    display: flex; flex-direction: column; gap: 4px;
  }
  .reviewer-label {
    display: flex; flex-direction: column; gap: 6px;
    font-size: 13px; color: var(--text-primary);
  }
  .reviewer-label select {
    padding: 5px 8px;
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    background: var(--bg-input);
    font: inherit;
  }
  .hint.sub { font-size: 11px; }
  button.ghost {
    align-self: flex-start;
    background: transparent;
    border: 1px solid var(--border-strong);
    color: var(--text-body);
    border-radius: 4px;
    padding: 4px 12px;
    cursor: pointer; font-size: 13px;
  }
  button.ghost:hover { background: var(--bg-hover); color: var(--text-primary); }
  button.ghost.danger-btn { border-color: var(--danger); color: var(--danger); }
  button.ghost.danger-btn:hover { background: var(--danger-bg); }

  .info-grid {
    display: grid; grid-template-columns: 1fr 1fr;
    gap: 8px 16px; margin-top: 4px; font-size: 13px;
  }
  .info-grid > .full { grid-column: 1 / -1; display: flex; align-items: center; gap: 6px; }
  .info-grid > div { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .info-label {
    font-size: 11px; color: var(--text-muted);
    text-transform: uppercase; letter-spacing: 0.04em; flex-shrink: 0;
  }
  .info-grid strong.warn {
    color: var(--warning);
  }
  .path-code {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    background: var(--bg-input);
    border: 1px solid var(--border-default);
    border-radius: 4px;
    padding: 3px 6px;
  }
  .version-warning,
  .version-ok {
    margin: 8px 0 0;
    font-size: 12px;
    line-height: 1.4;
  }
  .version-warning {
    color: var(--warning);
  }
  .version-ok {
    color: var(--success);
  }
  .info-grid a { color: var(--accent-text); text-decoration: none; }
  .info-grid a:hover { text-decoration: underline; }

  .cli-actions {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 4px;
    flex-wrap: wrap;
  }
  .primary-action {
    border: 1px solid var(--accent);
    background: var(--accent);
    color: var(--accent-on);
    border-radius: 4px;
    padding: 5px 10px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.02em;
    cursor: pointer;
    text-transform: uppercase;
  }
  .primary-action:hover:not(:disabled) { filter: brightness(0.98); }
  .primary-action:disabled {
    cursor: default;
    opacity: 0.65;
  }

  .cli-block { display: flex; flex-direction: column; gap: 4px; }
  .cli-row { display: flex; align-items: center; gap: 6px; }
  .cli-row code {
    flex: 1;
    background: var(--bg-input);
    border: 1px solid var(--border-default);
    color: var(--text-body);
    padding: 4px 8px; border-radius: 4px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11.5px; overflow-x: auto; white-space: nowrap;
  }
  .copy {
    background: transparent; border: 1px solid var(--border-default);
    color: var(--text-secondary); border-radius: 4px;
    padding: 2px 8px; cursor: pointer; font-size: 12px; flex-shrink: 0;
  }
  .copy:hover { background: var(--bg-hover); color: var(--text-primary); }
</style>
