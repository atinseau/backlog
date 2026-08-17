<script lang="ts">
  // Account-scoped API key entry, surfaced as a dedicated dialog so we
  // can open it from anywhere (profile dropdown, AgentsView hints,
  // Settings). Values live in ~/.backlog/secrets.json, encrypted at
  // rest, so repository-only transient boards and registered projects share
  // the same default keys. Project secrets can still override them.
  import {
    fetchSecretsList,
    setSecret as apiSetSecret,
    deleteSecret as apiDeleteSecret,
    type SecretKey,
  } from "./api.js";
  import { focusTrap } from "./DialogShell.svelte";
  import { t } from "./i18n.svelte.js";

  interface Props {
    onClose: () => void;
    onChanged?: () => void;
  }

  let { onClose, onChanged }: Props = $props();

  const PROVIDERS: { name: string; envVar: SecretKey; doc: string; hint: string }[] = [
    { name: "Anthropic (Claude)", envVar: "ANTHROPIC_API_KEY", doc: "https://console.anthropic.com/settings/keys", hint: "sk-ant-…" },
    { name: "OpenAI (Codex)",     envVar: "OPENAI_API_KEY",    doc: "https://platform.openai.com/api-keys",        hint: "sk-…" },
  ];

  let secretsState = $state<Record<string, boolean>>({});
  let secretInputs = $state<Record<string, string>>({});
  let secretBusy = $state<Record<string, boolean>>({});
  let secretError = $state<Record<string, string | null>>({});
  let loading = $state(true);

  async function load() {
    loading = true;
    try {
      const keys = await fetchSecretsList();
      const map: Record<string, boolean> = {};
      for (const k of keys) map[k.key] = k.set;
      secretsState = map;
    } catch {
      /* best-effort */
    } finally {
      loading = false;
    }
  }

  async function save(key: SecretKey) {
    const value = (secretInputs[key] ?? "").trim();
    if (!value) return;
    secretBusy = { ...secretBusy, [key]: true };
    secretError = { ...secretError, [key]: null };
    try {
      await apiSetSecret(key, value);
      secretsState = { ...secretsState, [key]: true };
      secretInputs = { ...secretInputs, [key]: "" };
      onChanged?.();
    } catch (err) {
      secretError = { ...secretError, [key]: err instanceof Error ? err.message : String(err) };
    } finally {
      secretBusy = { ...secretBusy, [key]: false };
    }
  }

  async function clear(key: SecretKey) {
    if (!confirm(t("settings.api_keys.delete_confirm"))) return;
    secretBusy = { ...secretBusy, [key]: true };
    try {
      await apiDeleteSecret(key);
      secretsState = { ...secretsState, [key]: false };
      onChanged?.();
    } catch (err) {
      secretError = { ...secretError, [key]: err instanceof Error ? err.message : String(err) };
    } finally {
      secretBusy = { ...secretBusy, [key]: false };
    }
  }

  load();
</script>

<div class="backdrop" onclick={onClose} role="presentation">
  <div
    use:focusTrap
    class="modal"
    onclick={(e) => e.stopPropagation()}
    role="dialog"
    aria-modal="true"
    tabindex={-1}
    onkeydown={(e) => { if (e.key === "Escape") onClose(); }}
  >
    <header>
      <div>
        <h2>{t("api_keys_dialog.title")}</h2>
        <p class="subtitle">{t("api_keys_dialog.subtitle")}</p>
      </div>
      <button class="close" onclick={onClose} aria-label={t("common.close")}>✕</button>
    </header>

    {#if loading}
      <div class="loading">…</div>
    {:else}
      <ul class="keys">
        {#each PROVIDERS as provider (provider.envVar)}
          {@const set = secretsState[provider.envVar] === true}
          <li>
            <div class="row">
              <div class="head">
                <strong>{provider.name}</strong>
                <span class="key-state" class:set>
                  {set ? "✓ " + t("settings.api_keys.set") : t("settings.api_keys.not_set")}
                </span>
                <a href={provider.doc} target="_blank" rel="noopener noreferrer" class="link-out">
                  ↗ {t("settings.api_keys.console")}
                </a>
              </div>
              <div class="input-row">
                <input
                  type="password"
                  placeholder={set ? t("settings.api_keys.replace_placeholder") : provider.hint}
                  value={secretInputs[provider.envVar] ?? ""}
                  oninput={(e) => (secretInputs = { ...secretInputs, [provider.envVar]: (e.currentTarget as HTMLInputElement).value })}
                  onkeydown={(e) => { if (e.key === "Enter") save(provider.envVar); }}
                  disabled={secretBusy[provider.envVar]}
                />
                <button
                  class="primary"
                  type="button"
                  onclick={() => save(provider.envVar)}
                  disabled={secretBusy[provider.envVar] || !((secretInputs[provider.envVar] ?? "").trim())}
                >
                  {secretBusy[provider.envVar] ? "…" : t("settings.api_keys.save")}
                </button>
                {#if set}
                  <button
                    class="ghost"
                    type="button"
                    onclick={() => clear(provider.envVar)}
                    disabled={secretBusy[provider.envVar]}
                    title={t("settings.api_keys.delete")}
                  >✕</button>
                {/if}
              </div>
              {#if secretError[provider.envVar]}
                <div class="error">{secretError[provider.envVar]}</div>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
      <footer class="hint">{t("api_keys_dialog.footer_hint")}</footer>
    {/if}
  </div>
</div>

<style>
  .backdrop {
    position: fixed; inset: 0;
    background: var(--backdrop);
    display: flex; align-items: center; justify-content: center;
    z-index: 200;
  }
  .modal {
    background: var(--bg-surface);
    color: var(--text-primary);
    border-radius: 8px;
    box-shadow: var(--shadow-modal);
    max-width: 560px;
    width: 92%;
    max-height: 88vh;
    max-height: 88dvh;
    display: flex; flex-direction: column;
    overflow: hidden;
  }
  header {
    padding: 16px 20px;
    border-bottom: 1px solid var(--border-default);
    display: flex; align-items: flex-start; justify-content: space-between;
    gap: 12px;
  }
  h2 { margin: 0; font-size: 16px; }
  .subtitle { margin: 4px 0 0; font-size: 12px; color: var(--text-muted); }
  .close {
    background: transparent;
    border: none;
    font-size: 18px;
    cursor: pointer;
    color: var(--text-secondary);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: var(--tap-size);
    min-height: var(--tap-size);
    border-radius: 4px;
  }
  button:focus-visible,
  .link-out:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .loading {
    padding: 32px;
    text-align: center;
    color: var(--text-muted);
    font-style: italic;
  }
  ul.keys {
    list-style: none;
    margin: 0;
    padding: 16px 20px;
    display: flex; flex-direction: column; gap: 14px;
    overflow-y: auto;
    flex: 1;
  }
  ul.keys li { padding: 0; }
  .row { display: flex; flex-direction: column; gap: 6px; }
  .head {
    display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap;
  }
  .head strong { font-size: 14px; }
  .key-state {
    font-size: 11px;
    color: var(--text-muted);
    background: var(--bg-hover);
    padding: 1px 6px;
    border-radius: 3px;
  }
  .key-state.set {
    background: var(--success-bg);
    color: var(--success);
  }
  .link-out {
    margin-left: auto;
    font-size: 11px;
    color: var(--accent);
    text-decoration: none;
  }
  .link-out:hover { text-decoration: underline; }
  /* Wraps rather than squeezing the key field below readability on a
     360px-wide viewport. */
  .input-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .input-row input {
    flex: 1;
    min-width: 160px;
    padding: 6px 10px;
    border: 1px solid var(--border-field);
    border-radius: 4px;
    background: var(--bg-input);
    font: inherit;
    font-size: 13px;
    font-family: ui-monospace, monospace;
  }
  .input-row input::placeholder { color: var(--text-muted); }
  .primary {
    background: var(--accent);
    color: var(--accent-on);
    border: none;
    border-radius: 4px;
    padding: 6px 12px;
    font: inherit;
    font-size: 12px;
    cursor: pointer;
    min-height: var(--tap-size);
  }
  .primary:disabled { opacity: 0.5; cursor: not-allowed; }
  .ghost {
    background: transparent;
    border: 1px solid var(--border-field);
    border-radius: 4px;
    padding: 4px 8px;
    color: var(--text-muted);
    cursor: pointer;
    font: inherit;
    font-size: 12px;
    min-width: var(--tap-size);
    min-height: var(--tap-size);
  }
  .ghost:hover { background: var(--bg-hover); color: var(--text-primary); }
  .error {
    color: var(--danger);
    font-size: 11px;
  }
  .hint {
    padding: 10px 20px;
    font-size: 11px;
    color: var(--text-muted);
    border-top: 1px solid var(--border-default);
    background: var(--bg-muted);
  }
</style>
