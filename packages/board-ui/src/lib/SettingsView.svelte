<script lang="ts">
  // Project-scoped settings — surfaces that read/write the active
  // project's state (chat history keyed by project id, project paths).
  // API keys are shown here for convenience but are account-scoped so
  // they work across normal projects and repository-only boards. General
  // app preferences (theme, locale, identity, notifications, CLI,
  // about, reset) live in GeneralSettingsView, opened from the
  // top-right profile dropdown.
  import { t } from "./i18n.svelte.js";
  import { clearChatHistory } from "./settings.svelte.js";
  import {
    fetchCurrentProject,
    fetchProjectsList,
    fetchSecretsList,
    setSecret as apiSetSecret,
    deleteSecret as apiDeleteSecret,
    type ProjectEntry,
    type SecretKey,
  } from "./api.js";

  interface Props {
    onClose: () => void;
    embedded?: boolean;
  }

  let { onClose, embedded = false }: Props = $props();

  let currentProject = $state<{ root: string; backlog_dir: string; resolved_from: string } | null>(null);
  let projects = $state<ProjectEntry[]>([]);
  let secretsState = $state<Record<string, boolean>>({});
  let secretInputs = $state<Record<string, string>>({});
  let secretBusy = $state<Record<string, boolean>>({});
  let secretError = $state<Record<string, string | null>>({});

  async function load() {
    try {
      [currentProject, projects] = await Promise.all([
        fetchCurrentProject(),
        fetchProjectsList(),
      ]);
    } catch { /* best-effort */ }
    await loadSecrets();
  }

  async function loadSecrets() {
    try {
      const keys = await fetchSecretsList();
      const map: Record<string, boolean> = {};
      for (const k of keys) map[k.key] = k.set;
      secretsState = map;
    } catch { /* best-effort */ }
  }

  async function saveSecret(key: SecretKey) {
    const value = (secretInputs[key] ?? "").trim();
    if (!value) return;
    secretBusy = { ...secretBusy, [key]: true };
    secretError = { ...secretError, [key]: null };
    try {
      await apiSetSecret(key, value);
      secretsState = { ...secretsState, [key]: true };
      secretInputs = { ...secretInputs, [key]: "" };
    } catch (err) {
      secretError = { ...secretError, [key]: err instanceof Error ? err.message : String(err) };
    } finally {
      secretBusy = { ...secretBusy, [key]: false };
    }
  }

  async function clearSecret(key: SecretKey) {
    if (!confirm(t("settings.api_keys.delete_confirm"))) return;
    secretBusy = { ...secretBusy, [key]: true };
    try {
      await apiDeleteSecret(key);
      secretsState = { ...secretsState, [key]: false };
    } catch (err) {
      secretError = { ...secretError, [key]: err instanceof Error ? err.message : String(err) };
    } finally {
      secretBusy = { ...secretBusy, [key]: false };
    }
  }

  function copy(text: string): void {
    navigator.clipboard?.writeText(text).catch(() => undefined);
  }

  function clearChatConfirm() {
    if (confirm(t("settings.chat.clear_confirm"))) clearChatHistory();
  }

  const currentProjectEntry = $derived(
    currentProject ? projects.find((p) => p.path === currentProject!.root) : null,
  );

  const API_KEY_PROVIDERS: { name: string; envVar: SecretKey; doc: string; hint: string }[] = [
    { name: "Anthropic (Claude)", envVar: "ANTHROPIC_API_KEY", doc: "https://console.anthropic.com/settings/keys", hint: "sk-ant-…" },
    { name: "OpenAI (Codex)", envVar: "OPENAI_API_KEY", doc: "https://platform.openai.com/api-keys", hint: "sk-…" },
  ];

  load();
</script>

{#snippet body()}
  <header>
    <h2>{t("settings.project.title")}</h2>
    {#if !embedded}
      <button class="close" onclick={onClose}>✕</button>
    {/if}
  </header>

  <div class="content">
    <!-- Project info -->
    {#if currentProject}
      <section class="block">
        <h3>{t("settings.project.info_title")}</h3>
        <p class="hint">{t("settings.project.hint")}</p>
        <div class="info-grid">
          {#if currentProjectEntry}
            <div><span class="info-label">{t("settings.project.name")}</span><strong>{currentProjectEntry.name}</strong></div>
            <div><span class="info-label">{t("settings.project.location")}</span>
              <span class="loc-pill">{currentProjectEntry.location === "user_level" ? t("manage_projects.location.user_level") : t("manage_projects.location.project_folder")}</span>
            </div>
          {/if}
          <div class="full">
            <span class="info-label">{t("settings.project.path")}</span>
            <code>{currentProject.root}</code>
            <button class="copy" onclick={() => copy(currentProject!.root)} title={t("settings.copy")}>⎘</button>
          </div>
          <div class="full">
            <span class="info-label">{t("settings.project.backlog_dir")}</span>
            <code>{currentProject.backlog_dir}</code>
            <button class="copy" onclick={() => copy(currentProject!.backlog_dir)} title={t("settings.copy")}>⎘</button>
          </div>
        </div>
      </section>
    {/if}

    <!-- API Keys -->
    <section class="block">
      <h3>{t("settings.api_keys.title")}</h3>
      <p class="hint">{t("settings.api_keys.hint")}</p>
      <ul class="keys">
        {#each API_KEY_PROVIDERS as provider (provider.envVar)}
          {@const set = secretsState[provider.envVar] === true}
          <li class="key">
            <div class="key-head">
              <strong>{provider.name}</strong>
              <span class="key-state" class:set>{set ? "✓ " + t("settings.api_keys.set") : t("settings.api_keys.not_set")}</span>
              <a href={provider.doc} target="_blank" rel="noopener noreferrer" class="link-out">↗ {t("settings.api_keys.console")}</a>
            </div>
            <div class="key-row">
              <input
                type="password"
                placeholder={set ? t("settings.api_keys.replace_placeholder") : provider.hint}
                value={secretInputs[provider.envVar] ?? ""}
                oninput={(e) => (secretInputs = { ...secretInputs, [provider.envVar]: (e.currentTarget as HTMLInputElement).value })}
                onkeydown={(e) => { if (e.key === "Enter") void saveSecret(provider.envVar); }}
                disabled={secretBusy[provider.envVar]}
                autocomplete="off"
              />
              <button
                class="primary small"
                onclick={() => saveSecret(provider.envVar)}
                disabled={secretBusy[provider.envVar] || !(secretInputs[provider.envVar] ?? "").trim()}
              >
                {secretBusy[provider.envVar] ? "…" : t("settings.api_keys.save")}
              </button>
              {#if set}
                <button
                  class="ghost small"
                  onclick={() => clearSecret(provider.envVar)}
                  disabled={secretBusy[provider.envVar]}
                  title={t("settings.api_keys.delete")}
                >✕</button>
              {/if}
            </div>
            {#if secretError[provider.envVar]}
              <div class="msg err">{secretError[provider.envVar]}</div>
            {/if}
            <details class="cli-fallback">
              <summary>{t("settings.api_keys.cli_alt")}</summary>
              <div class="cli-row">
                <code>backlog secrets set {provider.envVar}=…</code>
                <button class="copy" onclick={() => copy(`backlog secrets set ${provider.envVar}=`)} title={t("settings.copy")}>⎘</button>
              </div>
            </details>
          </li>
        {/each}
      </ul>
    </section>

    <!-- Chat -->
    <section class="block">
      <h3>{t("settings.chat.title")}</h3>
      <p class="hint">{t("settings.chat.hint")}</p>
      <button class="ghost" onclick={clearChatConfirm}>{t("settings.chat.clear")}</button>
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
    max-width: 640px; width: 92%;
    max-height: 85vh;
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
  }
  h2 { margin: 0; font-size: 16px; color: var(--text-primary); }
  /* WCAG 2.5.8: the glyph is 18px but the target floors at --tap-size. */
  .close {
    background: transparent; border: none; font-size: 18px; cursor: pointer;
    color: var(--text-secondary);
    min-width: var(--tap-size); min-height: var(--tap-size);
    display: inline-flex; align-items: center; justify-content: center;
    border-radius: 4px;
  }
  .close:hover { background: var(--bg-hover); color: var(--text-primary); }
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
  h3 {
    margin: 0; font-size: 13px; font-weight: 600;
    color: var(--text-body);
    text-transform: uppercase; letter-spacing: 0.04em;
  }
  .hint { margin: 0; font-size: 12px; color: var(--text-muted); line-height: 1.45; }

  button.ghost {
    align-self: flex-start;
    background: transparent;
    /* Transparent control on a surface: WCAG 1.4.11 asks 3:1. */
    border: 1px solid var(--border-field);
    color: var(--text-body);
    border-radius: 4px;
    padding: 4px 12px;
    cursor: pointer; font-size: 13px;
    min-height: var(--tap-size);
  }
  button.ghost:hover { background: var(--bg-hover); color: var(--text-primary); }

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
  .info-grid code {
    flex: 1;
    background: var(--bg-input);
    border: 1px solid var(--border-default);
    padding: 2px 6px; border-radius: 3px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    color: var(--text-body);
  }
  .loc-pill {
    background: var(--bg-elevated); color: var(--text-body);
    padding: 1px 8px; border-radius: 999px;
    font-size: 11px; font-weight: 500;
  }

  .keys {
    list-style: none; padding: 0; margin: 0;
    display: flex; flex-direction: column; gap: 10px;
  }
  .key {
    border: 1px solid var(--border-default);
    border-radius: 6px;
    padding: 10px 12px;
    background: var(--bg-elevated);
  }
  .key-head {
    display: flex; align-items: center; gap: 10px;
    margin-bottom: 8px;
  }
  .key-head strong { font-size: 13px; color: var(--text-primary); flex-shrink: 0; }
  .key-state {
    font-size: 11px; color: var(--text-muted);
    padding: 1px 7px; border-radius: 999px;
    background: var(--bg-hover);
  }
  .key-state.set {
    color: var(--success); background: var(--success-bg);
  }
  .link-out {
    font-size: 11px; color: var(--accent-text);
    text-decoration: none; margin-left: auto;
  }
  .link-out:hover { text-decoration: underline; }
  .key-row {
    display: flex; align-items: center; gap: 6px;
  }
  .key-row input[type="password"] {
    flex: 1;
    padding: 5px 10px;
    /* Input outline: WCAG 1.4.11 asks 3:1, --border-strong gives 1.47:1. */
    border: 1px solid var(--border-field);
    border-radius: 4px;
    background: var(--bg-input);
    color: var(--text-primary);
    font-size: 13px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    min-height: var(--tap-size);
  }
  .key-row input[type="password"]:focus { outline: none; border-color: var(--accent); }
  button.primary.small {
    background: var(--accent); color: var(--accent-on);
    border: 1px solid var(--accent);
    padding: 4px 12px; border-radius: 4px;
    font-size: 12px; cursor: pointer;
    min-height: var(--tap-size);
  }
  button.primary.small:hover:not(:disabled) { background: var(--accent-hover); }
  button.primary.small:disabled { opacity: 0.4; cursor: not-allowed; }
  button.ghost.small {
    background: transparent;
    border: 1px solid var(--border-field);
    color: var(--text-secondary);
    padding: 4px 8px; border-radius: 4px;
    font-size: 12px; cursor: pointer;
    min-height: var(--tap-size);
    min-width: var(--tap-size);
  }
  button.ghost.small:hover:not(:disabled) {
    background: var(--bg-hover); color: var(--text-primary);
  }
  .cli-fallback {
    margin-top: 6px;
    font-size: 11px;
  }
  .cli-fallback summary {
    cursor: pointer;
    color: var(--text-muted);
    user-select: none;
    /* WCAG 2.5.8 floor for the disclosure target. */
    min-height: var(--tap-size);
    padding: 4px 0;
  }
  .cli-fallback summary:hover { color: var(--text-body); }
  .cli-fallback .cli-row { margin-top: 6px; }
  .cli-row { display: flex; align-items: center; gap: 6px; }
  .cli-row code {
    flex: 1;
    background: var(--bg-input);
    border: 1px solid var(--border-default);
    color: var(--text-body);
    padding: 4px 8px; border-radius: 4px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px; overflow-x: auto; white-space: nowrap;
  }
  .copy {
    background: transparent; border: 1px solid var(--border-default);
    color: var(--text-secondary); border-radius: 4px;
    padding: 2px 8px; cursor: pointer; font-size: 12px; flex-shrink: 0;
    min-height: var(--tap-size); min-width: var(--tap-size);
  }
  .copy:hover { background: var(--bg-hover); color: var(--text-primary); }
  .msg.err {
    background: var(--danger-bg); color: var(--danger);
    padding: 4px 8px; border-radius: 4px;
    font-size: 11px; margin-top: 6px;
  }

  /* BP_NARROW — src/lib/shell/breakpoints.ts */
  @media (max-width: 640px) {
    .info-grid {
      grid-template-columns: 1fr;
    }
    .key-head { flex-wrap: wrap; }
    .link-out { margin-left: 0; }
  }
</style>
