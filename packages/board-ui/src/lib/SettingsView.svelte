<script lang="ts">
  // App-level settings — the home for per-device UI preferences plus
  // ship-ready surfaces that don't fit elsewhere: API keys, CLI info,
  // workspace info, about, reset. Workspace policy (autonomy mode,
  // claim TTL, …) lives in the Permissions section since those are
  // persisted in config.toml on disk.
  import LocaleToggle from "./LocaleToggle.svelte";
  import ThemeToggle from "./ThemeToggle.svelte";
  import { t } from "./i18n.svelte.js";
  import {
    getShowReviewColumn, setShowReviewColumn,
    getNotifyOnRunComplete, setNotifyOnRunComplete,
    getDisplayName, setDisplayName, deriveInitials,
    resetOnboarding,
    clearChatHistory,
    resetAllLocalSettings,
  } from "./settings.svelte.js";
  import {
    fetchHealth,
    fetchCurrentProject,
    fetchProjectsList,
    type ProjectEntry,
  } from "./api.js";

  interface Props {
    onClose: () => void;
    embedded?: boolean;
  }

  let { onClose, embedded = false }: Props = $props();

  const showReview = $derived(getShowReviewColumn());
  const notifyRuns = $derived(getNotifyOnRunComplete());
  const displayName = $derived(getDisplayName());

  let health = $state<{ ok: boolean; workspace: string; version: string } | null>(null);
  let currentProject = $state<{ root: string; backlog_dir: string; resolved_from: string } | null>(null);
  let projects = $state<ProjectEntry[]>([]);

  async function load() {
    try {
      [health, currentProject, projects] = await Promise.all([
        fetchHealth(),
        fetchCurrentProject(),
        fetchProjectsList(),
      ]);
    } catch {
      // Best-effort — sections that need a value will hide themselves.
    }
  }

  const currentProjectEntry = $derived(
    currentProject ? projects.find((p) => p.path === currentProject!.root) : null,
  );

  function copy(text: string): void {
    navigator.clipboard?.writeText(text).catch(() => undefined);
  }

  function toggleReview(event: Event) {
    setShowReviewColumn((event.currentTarget as HTMLInputElement).checked);
  }
  function toggleNotify(event: Event) {
    const value = (event.currentTarget as HTMLInputElement).checked;
    setNotifyOnRunComplete(value);
    if (value && typeof Notification !== "undefined" && Notification.permission === "default") {
      // Best-effort: ask for permission on opt-in. The actual wiring
      // (firing notifications when run.changed lands) plugs in later.
      Notification.requestPermission().catch(() => undefined);
    }
  }

  function clearChatConfirm() {
    if (confirm(t("settings.chat.clear_confirm"))) {
      clearChatHistory();
    }
  }

  function resetConfirm() {
    if (confirm(t("settings.reset.confirm"))) {
      resetAllLocalSettings();
    }
  }

  // API keys are persisted in the workspace's secrets.json (encrypted
  // at rest by the OS keychain helpers). We don't expose a list-secrets
  // endpoint; the user manages them via the CLI. This list is the set
  // of recognised keys so the UI can guide which env var name to use.
  const API_KEY_PROVIDERS: { name: string; envVar: string; doc: string }[] = [
    { name: "Anthropic (Claude)", envVar: "ANTHROPIC_API_KEY", doc: "https://console.anthropic.com/settings/keys" },
    { name: "OpenAI (Codex)", envVar: "OPENAI_API_KEY", doc: "https://platform.openai.com/api-keys" },
  ];

  load();
</script>

{#snippet body()}
  <header>
    <h2>{t("settings.title")}</h2>
    {#if !embedded}
      <button class="close" onclick={onClose}>✕</button>
    {/if}
  </header>

  <div class="content">
    <!-- Apparence -->
    <section class="block">
      <h3>{t("settings.appearance.title")}</h3>
      <p class="hint">{t("settings.appearance.hint")}</p>
      <div class="row">
        <label>{t("theme.label")}</label>
        <ThemeToggle />
      </div>
      <div class="row">
        <label>{t("settings.locale")}</label>
        <LocaleToggle />
      </div>
    </section>

    <!-- Identité affichée -->
    <section class="block">
      <h3>{t("settings.identity.title")}</h3>
      <p class="hint">{t("settings.identity.hint")}</p>
      <div class="identity-row">
        <input
          type="text"
          class="text-input"
          placeholder={t("settings.identity.placeholder")}
          value={displayName}
          oninput={(e) => setDisplayName((e.currentTarget as HTMLInputElement).value)}
        />
        <span class="preview-pill" aria-hidden="true">{deriveInitials(displayName ? `${displayName}@local` : "")}</span>
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

    <!-- Chat -->
    <section class="block">
      <h3>{t("settings.chat.title")}</h3>
      <p class="hint">{t("settings.chat.hint")}</p>
      <button class="ghost" onclick={clearChatConfirm}>{t("settings.chat.clear")}</button>
    </section>

    <!-- API Keys -->
    <section class="block">
      <h3>{t("settings.api_keys.title")}</h3>
      <p class="hint">{t("settings.api_keys.hint")}</p>
      <ul class="keys">
        {#each API_KEY_PROVIDERS as provider (provider.envVar)}
          <li class="key">
            <div class="key-head">
              <strong>{provider.name}</strong>
              <a href={provider.doc} target="_blank" rel="noopener noreferrer" class="link-out">↗ {t("settings.api_keys.console")}</a>
            </div>
            <div class="cli-row">
              <code>backlog secrets set {provider.envVar}=…</code>
              <button class="copy" onclick={() => copy(`backlog secrets set ${provider.envVar}=`)} title={t("settings.copy")}>⎘</button>
            </div>
          </li>
        {/each}
      </ul>
      <p class="hint footnote">
        {t("settings.api_keys.footnote")}
        <a href="https://github.com/osmove/backlog#secrets" target="_blank" rel="noopener noreferrer">{t("settings.api_keys.docs_link")}</a>
      </p>
    </section>

    <!-- Workspace -->
    <section class="block">
      <h3>{t("settings.workspace.title")}</h3>
      <p class="hint">{t("settings.workspace.hint")}</p>
      {#if currentProject}
        <div class="info-grid">
          {#if currentProjectEntry}
            <div><span class="info-label">{t("settings.workspace.name")}</span><strong>{currentProjectEntry.name}</strong></div>
            <div><span class="info-label">{t("settings.workspace.location")}</span>
              <span class="loc-pill">{currentProjectEntry.location === "user_level" ? "user-level" : "in-repo"}</span>
            </div>
          {/if}
          <div class="full">
            <span class="info-label">{t("settings.workspace.path")}</span>
            <code>{currentProject.root}</code>
            <button class="copy" onclick={() => copy(currentProject!.root)} title={t("settings.copy")}>⎘</button>
          </div>
          <div class="full">
            <span class="info-label">{t("settings.workspace.backlog_dir")}</span>
            <code>{currentProject.backlog_dir}</code>
            <button class="copy" onclick={() => copy(currentProject!.backlog_dir)} title={t("settings.copy")}>⎘</button>
          </div>
        </div>
      {/if}
    </section>

    <!-- CLI -->
    <section class="block">
      <h3>{t("settings.cli.title")}</h3>
      <p class="hint">{t("settings.cli.hint")}</p>
      <div class="info-grid">
        <div><span class="info-label">{t("settings.cli.version")}</span><strong>{health?.version ?? "—"}</strong></div>
        <div><span class="info-label">{t("settings.cli.npm")}</span><a href="https://www.npmjs.com/package/backlog" target="_blank" rel="noopener noreferrer">backlog ↗</a></div>
      </div>
      <div class="cli-block">
        <div class="cli-row">
          <code>npm install -g backlog</code>
          <button class="copy" onclick={() => copy("npm install -g backlog")} title={t("settings.copy")}>⎘</button>
        </div>
        <div class="cli-row">
          <code>pnpm add -g backlog</code>
          <button class="copy" onclick={() => copy("pnpm add -g backlog")} title={t("settings.copy")}>⎘</button>
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
        <div><span class="info-label">Backlog</span><strong>v{health?.version ?? "—"}</strong></div>
        <div><span class="info-label">{t("settings.about.license")}</span><strong>Apache-2.0</strong></div>
        <div class="full"><a href="https://github.com/osmove/backlog" target="_blank" rel="noopener noreferrer">github.com/osmove/backlog ↗</a></div>
        <div class="full"><a href="https://github.com/osmove/backlog/issues" target="_blank" rel="noopener noreferrer">{t("settings.about.report_issue")} ↗</a></div>
      </div>
    </section>
  </div>
{/snippet}

{#if embedded}
  <div class="embedded">{@render body()}</div>
{:else}
  <div class="backdrop" onclick={onClose} role="presentation">
    <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex={-1} onkeydown={(e) => { if (e.key === "Escape") onClose(); }}>
      {@render body()}
    </div>
  </div>
{/if}

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
    max-width: 640px; width: 92%; max-height: 85vh;
    display: flex; flex-direction: column; overflow: hidden;
  }
  .embedded {
    background: var(--bg-app);
    color: var(--text-primary);
    height: 100%; width: 100%;
    display: flex; flex-direction: column; overflow: hidden;
  }

  header {
    padding: 16px 20px;
    border-bottom: 1px solid var(--border-default);
    display: flex; align-items: center; justify-content: space-between;
    gap: 12px;
  }
  h2 { margin: 0; font-size: 16px; color: var(--text-primary); }
  .close {
    background: transparent; border: none;
    font-size: 18px; cursor: pointer;
    color: var(--text-secondary);
  }

  .content {
    overflow-y: auto;
    padding: 16px 20px 32px;
    display: flex; flex-direction: column; gap: 20px;
    max-width: 760px;
  }

  .block {
    display: flex; flex-direction: column; gap: 8px;
    padding-bottom: 16px;
    border-bottom: 1px solid var(--border-subtle);
  }
  .block:last-child { border-bottom: none; }
  .block.danger { border-color: var(--danger-bg); }

  h3 {
    margin: 0;
    font-size: 13px; font-weight: 600;
    color: var(--text-body);
    text-transform: uppercase; letter-spacing: 0.04em;
  }
  .hint {
    margin: 0;
    font-size: 12px; color: var(--text-muted);
    line-height: 1.45;
  }
  .footnote { margin-top: 6px; }
  .footnote a { color: var(--accent-text); }

  .row {
    display: flex; align-items: center; justify-content: space-between;
    gap: 12px; padding: 6px 0;
  }
  .row label { font-size: 13px; color: var(--text-body); }

  .toggle {
    display: flex; align-items: flex-start; gap: 10px;
    cursor: pointer; padding: 6px 0;
  }
  .toggle input[type="checkbox"] {
    width: 16px; height: 16px;
    margin-top: 2px;
    accent-color: var(--accent);
    flex-shrink: 0;
  }
  .toggle-label {
    display: block; font-size: 13px; color: var(--text-primary);
  }
  .toggle-desc {
    display: block; font-size: 12px; color: var(--text-muted); margin-top: 2px;
  }

  button.ghost {
    align-self: flex-start;
    background: transparent;
    border: 1px solid var(--border-strong);
    color: var(--text-body);
    border-radius: 4px;
    padding: 4px 12px;
    cursor: pointer;
    font-size: 13px;
  }
  button.ghost:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  button.ghost.danger-btn {
    border-color: var(--danger);
    color: var(--danger);
  }
  button.ghost.danger-btn:hover {
    background: var(--danger-bg);
    color: var(--danger);
  }

  /* API keys list */
  .keys {
    list-style: none; padding: 0; margin: 0;
    display: flex; flex-direction: column; gap: 10px;
  }
  .key {
    border: 1px solid var(--border-default);
    border-radius: 6px;
    padding: 8px 10px;
    background: var(--bg-elevated);
  }
  .key-head {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 6px;
  }
  .key-head strong { font-size: 13px; color: var(--text-primary); }
  .link-out {
    font-size: 11px; color: var(--accent-text);
    text-decoration: none;
  }
  .link-out:hover { text-decoration: underline; }

  .cli-block {
    display: flex; flex-direction: column; gap: 4px;
  }
  .cli-row {
    display: flex; align-items: center; gap: 6px;
  }
  .cli-row code {
    flex: 1;
    background: var(--bg-input);
    border: 1px solid var(--border-default);
    color: var(--text-body);
    padding: 4px 8px;
    border-radius: 4px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11.5px;
    overflow-x: auto;
    white-space: nowrap;
  }
  .copy {
    background: transparent;
    border: 1px solid var(--border-default);
    color: var(--text-secondary);
    border-radius: 4px;
    padding: 2px 8px;
    cursor: pointer;
    font-size: 12px;
    flex-shrink: 0;
  }
  .copy:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  /* Workspace + CLI info grids */
  .info-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px 16px;
    margin-top: 4px;
    font-size: 13px;
  }
  .info-grid > .full { grid-column: 1 / -1; display: flex; align-items: center; gap: 6px; }
  .info-grid > div { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .info-label {
    font-size: 11px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    flex-shrink: 0;
  }
  .info-grid code {
    flex: 1;
    background: var(--bg-input);
    border: 1px solid var(--border-default);
    padding: 2px 6px;
    border-radius: 3px;
    font-family: ui-monospace, monospace;
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-body);
  }
  .info-grid a { color: var(--accent-text); text-decoration: none; }
  .info-grid a:hover { text-decoration: underline; }

  .loc-pill {
    background: var(--bg-elevated);
    color: var(--text-body);
    padding: 1px 8px;
    border-radius: 10px;
    font-size: 11px;
    font-weight: 500;
  }

  .identity-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .text-input {
    flex: 1;
    padding: 6px 10px;
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    background: var(--bg-input);
    color: var(--text-primary);
    font-size: 13px;
  }
  .text-input:focus {
    outline: none;
    border-color: var(--accent);
  }
  .preview-pill {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    background: var(--success-bg);
    color: var(--success);
    border: 1px solid var(--success);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 600;
    flex-shrink: 0;
  }
</style>
