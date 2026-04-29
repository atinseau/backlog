<script lang="ts">
  // App-level settings — the home for per-device UI preferences. Workspace
  // policy (autonomy mode, claim TTL, …) lives in the Permissions section
  // since those are persisted in config.toml on disk.
  import LocaleToggle from "./LocaleToggle.svelte";
  import ThemeToggle from "./ThemeToggle.svelte";
  import { t } from "./i18n.svelte.js";
  import {
    getShowReviewColumn,
    setShowReviewColumn,
    resetOnboarding,
  } from "./settings.svelte.js";

  interface Props {
    onClose: () => void;
    embedded?: boolean;
  }

  let { onClose, embedded = false }: Props = $props();

  // Read state through the getter so Svelte 5 picks up the reactivity
  // (the module exports a $state-backed value).
  const showReview = $derived(getShowReviewColumn());

  function toggleReview(event: Event) {
    setShowReviewColumn((event.currentTarget as HTMLInputElement).checked);
  }
</script>

{#snippet body()}
  <header>
    <h2>{t("settings.title")}</h2>
    {#if !embedded}
      <button class="close" onclick={onClose}>✕</button>
    {/if}
  </header>

  <div class="content">
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

    <section class="block">
      <h3>{t("settings.onboarding.title")}</h3>
      <p class="hint">{t("settings.onboarding.hint")}</p>
      <button class="ghost" onclick={resetOnboarding}>{t("settings.onboarding.reset")}</button>
    </section>

    <section class="block muted-section">
      <h3>{t("settings.workspace.title")}</h3>
      <p class="hint">{t("settings.workspace.hint")}</p>
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
    position: fixed;
    inset: 0;
    background: var(--backdrop);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }
  .modal {
    background: var(--bg-surface);
    color: var(--text-primary);
    border-radius: 8px;
    box-shadow: var(--shadow-modal);
    max-width: 640px;
    width: 92%;
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .embedded {
    background: var(--bg-app);
    color: var(--text-primary);
    height: 100%;
    width: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  header {
    padding: 16px 20px;
    border-bottom: 1px solid var(--border-default);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  h2 {
    margin: 0;
    font-size: 16px;
    color: var(--text-primary);
  }
  .close {
    background: transparent;
    border: none;
    font-size: 18px;
    cursor: pointer;
    color: var(--text-secondary);
  }

  .content {
    overflow-y: auto;
    padding: 16px 20px;
    display: flex;
    flex-direction: column;
    gap: 20px;
    max-width: 720px;
  }

  .block {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-bottom: 16px;
    border-bottom: 1px solid var(--border-subtle);
  }
  .block:last-child {
    border-bottom: none;
  }
  h3 {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-body);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .hint {
    margin: 0;
    font-size: 12px;
    color: var(--text-muted);
    line-height: 1.4;
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 6px 0;
  }
  .row label {
    font-size: 13px;
    color: var(--text-body);
  }

  .toggle {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    cursor: pointer;
    padding: 6px 0;
  }
  .toggle input[type="checkbox"] {
    width: 16px;
    height: 16px;
    margin-top: 2px;
    accent-color: var(--accent);
    flex-shrink: 0;
  }
  .toggle-label {
    display: block;
    font-size: 13px;
    color: var(--text-primary);
  }
  .toggle-desc {
    display: block;
    font-size: 12px;
    color: var(--text-muted);
    margin-top: 2px;
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

  .muted-section h3 { color: var(--text-muted); }
  .muted-section .hint { color: var(--text-subtle); }
</style>
