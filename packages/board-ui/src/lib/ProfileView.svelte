<script lang="ts">
  // Profile / account modal — split out of IntegrationsView so account
  // is reachable from the topbar dropdown without bringing the whole
  // GitHub / Jira / Sources surface along.
  import { t } from "./i18n.svelte.js";
  import {
    fetchCloudStatus,
    cloudLogin,
    cloudLogout,
    cloudSignup,
    startCloudOauth,
    cloudBillingCheckout,
    cloudBillingPortal,
    type CloudStatus,
    type OauthProvider,
  } from "./api.js";

  interface Props {
    onClose: () => void;
    onChanged?: () => void;
    initialMode?: "signin" | "signup";
  }

  let { onClose, onChanged, initialMode = "signin" }: Props = $props();

  let cloudStatus = $state<CloudStatus | null>(null);
  // svelte-ignore state_referenced_locally
  let mode = $state<"signin" | "signup">(initialMode);
  let email = $state("");
  let password = $state("");
  let busy = $state(false);
  let error = $state<string | null>(null);
  let oauthBusy = $state<OauthProvider | null>(null);
  let billingBusy = $state(false);
  let billingError = $state<string | null>(null);

  async function load() {
    try {
      cloudStatus = await fetchCloudStatus();
    } catch {
      cloudStatus = { signed_in: false };
    }
  }

  function mapError(value: string | undefined): string {
    if (!value) return "";
    if (value === "invalid_credentials") return t("account.error.invalid_credentials");
    if (value === "invalid_input" || value === "invalid_body") return t("account.error.invalid_input");
    if (value === "cloud_unreachable") return t("account.error.cloud_unreachable");
    if (value === "rate_limited") return t("account.error.rate_limited");
    return value;
  }

  function openInNewTab(url: string) {
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function startOauth(provider: OauthProvider) {
    oauthBusy = provider;
    error = null;
    try {
      const result = await startCloudOauth(provider);
      openInNewTab(result.authorize_url);
      const intervalId = setInterval(async () => {
        const status = await fetchCloudStatus();
        if (status.signed_in) {
          clearInterval(intervalId);
          oauthBusy = null;
          await load();
          onChanged?.();
        }
      }, 2000);
      setTimeout(() => {
        clearInterval(intervalId);
        if (oauthBusy === provider) oauthBusy = null;
      }, 5 * 60_000);
    } catch (err) {
      oauthBusy = null;
      error = err instanceof Error ? err.message : String(err);
    }
  }

  async function submit() {
    busy = true;
    error = null;
    try {
      const fn = mode === "signup" ? cloudSignup : cloudLogin;
      const result = await fn({ email: email.trim(), password });
      if (!result.ok) {
        if (result.error === "invalid_input" && mode === "signup") {
          error = t("account.error.email_taken");
        } else {
          error = mapError(result.error);
        }
        return;
      }
      password = "";
      await load();
      onChanged?.();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }

  async function logout() {
    await cloudLogout();
    await load();
    onChanged?.();
  }

  async function upgrade() {
    billingBusy = true;
    billingError = null;
    try {
      const result = await cloudBillingCheckout("monthly");
      if (result.url) openInNewTab(result.url);
      else billingError = result.error ?? "checkout_failed";
    } catch (err) {
      billingError = err instanceof Error ? err.message : String(err);
    } finally {
      billingBusy = false;
    }
  }

  async function manageBilling() {
    billingBusy = true;
    billingError = null;
    try {
      const result = await cloudBillingPortal();
      if (result.url) openInNewTab(result.url);
      else billingError = result.error ?? "portal_failed";
    } catch (err) {
      billingError = err instanceof Error ? err.message : String(err);
    } finally {
      billingBusy = false;
    }
  }

  load();
</script>

<div class="backdrop" onclick={onClose} role="presentation">
  <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex={-1} onkeydown={(e) => { if (e.key === "Escape") onClose(); }}>
    <header>
      <h2>{t("profile.title")}</h2>
      <button class="close" onclick={onClose}>✕</button>
    </header>

    <div class="content">
      {#if cloudStatus?.signed_in && cloudStatus.user}
        <div class="status ok">{t("account.signed_in_as", { email: cloudStatus.user.email })}</div>
        <div class="meta-grid">
          <div class="meta-item">
            <span class="meta-label">{t("account.plan")}</span>
            <span class="plan-pill plan-{cloudStatus.user.plan}">
              {t(`account.plan.${cloudStatus.user.plan}`)}
            </span>
          </div>
          <div class="meta-item">
            <span class="meta-label">GitHub</span>
            {#if cloudStatus.user.repos_limit === null}
              <span>{t("account.repos_unlimited")}</span>
            {:else}
              <span class:over={cloudStatus.user.repos_used >= cloudStatus.user.repos_limit}>
                {t("account.repos_quota", {
                  used: cloudStatus.user.repos_used,
                  limit: cloudStatus.user.repos_limit,
                })}
              </span>
            {/if}
          </div>
        </div>
        <div class="row">
          {#if cloudStatus.user.plan === "free"}
            <button class="primary" onclick={upgrade} disabled={billingBusy}>
              {billingBusy ? t("account.button.upgrading") : t("account.button.upgrade")}
            </button>
          {:else}
            <button onclick={manageBilling} disabled={billingBusy}>
              {billingBusy ? t("account.button.opening_portal") : t("account.button.manage_billing")}
            </button>
          {/if}
          <button onclick={logout}>{t("account.button.logout")}</button>
        </div>
        {#if billingError}<div class="msg err">{billingError}</div>{/if}
      {:else if cloudStatus}
        <div class="status">{t("account.signed_out")}</div>
        <div class="oauth-buttons">
          <button class="oauth oauth-google" onclick={() => startOauth("google_oauth2")} disabled={oauthBusy !== null}>
            <span class="oauth-icon">G</span>
            {oauthBusy === "google_oauth2" ? t("account.oauth.waiting") : t("account.oauth.google")}
          </button>
          <button class="oauth oauth-github" onclick={() => startOauth("github")} disabled={oauthBusy !== null}>
            <span class="oauth-icon">⌥</span>
            {oauthBusy === "github" ? t("account.oauth.waiting") : t("account.oauth.github")}
          </button>
          <button class="oauth oauth-apple" onclick={() => startOauth("apple")} disabled={oauthBusy !== null}>
            <span class="oauth-icon"></span>
            {oauthBusy === "apple" ? t("account.oauth.waiting") : t("account.oauth.apple")}
          </button>
        </div>
        <div class="divider"><span>{t("account.oauth.or")}</span></div>
        <label class="field">
          <span class="label">{t("account.email")}</span>
          <input type="email" bind:value={email} autocomplete="email" />
        </label>
        <label class="field">
          <span class="label">{t("account.password")}</span>
          <input type="password" bind:value={password} autocomplete={mode === "signup" ? "new-password" : "current-password"} />
        </label>
        {#if error}<div class="msg err">{error}</div>{/if}
        <div class="row connect-actions">
          <button class="primary" onclick={submit} disabled={busy || !email || password.length < 8}>
            {#if mode === "signup"}
              {busy ? t("account.button.signing_up") : t("account.button.signup")}
            {:else}
              {busy ? t("account.button.signing_in") : t("account.button.signin")}
            {/if}
          </button>
          <button class="link" onclick={() => { mode = mode === "signup" ? "signin" : "signup"; error = null; }}>
            {mode === "signup" ? t("account.toggle_signin") : t("account.toggle_signup")}
          </button>
        </div>
      {:else}
        <div class="loading">…</div>
      {/if}
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
    max-width: 480px; width: 92%;
    max-height: 90vh;
    display: flex; flex-direction: column;
    overflow: hidden;
  }
  header {
    padding: 16px 20px;
    border-bottom: 1px solid var(--border-default);
    display: flex; justify-content: space-between; align-items: center;
  }
  h2 { margin: 0; font-size: 16px; }
  .close {
    background: transparent; border: none;
    font-size: 18px; cursor: pointer;
    color: var(--text-secondary);
  }
  .content { padding: 20px; overflow-y: auto; }
  .status {
    padding: 10px 12px; border-radius: 6px;
    background: var(--bg-elevated); color: var(--text-body);
    font-size: 13px; margin-bottom: 14px;
  }
  .status.ok {
    background: var(--success-bg); color: var(--success);
  }
  .meta-grid {
    display: grid; grid-template-columns: 1fr 1fr;
    gap: 12px; margin-bottom: 14px;
  }
  .meta-item { display: flex; flex-direction: column; gap: 2px; font-size: 13px; }
  .meta-label {
    font-size: 11px; color: var(--text-muted);
    text-transform: uppercase; letter-spacing: 0.04em;
  }
  .plan-pill {
    display: inline-block;
    padding: 2px 8px; border-radius: 12px;
    font-size: 11px; font-weight: 600;
    background: var(--bg-elevated); color: var(--text-body);
    width: fit-content;
  }
  .plan-pill.plan-pro { background: var(--accent-bg); color: var(--accent-text); }
  .over { color: var(--warning); font-weight: 500; }
  .row { display: flex; gap: 8px; align-items: center; }
  .connect-actions { margin-top: 12px; }
  button {
    padding: 6px 12px; border-radius: 4px;
    border: 1px solid var(--border-strong);
    background: transparent; color: var(--text-body);
    cursor: pointer; font-size: 13px;
  }
  button:hover { background: var(--bg-hover); color: var(--text-primary); }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  button.primary {
    background: var(--accent); color: var(--accent-on);
    border-color: var(--accent); font-weight: 500;
  }
  button.primary:hover { background: var(--accent-hover); border-color: var(--accent-hover); }
  button.link {
    border: none; padding: 6px 8px;
    color: var(--text-secondary); background: transparent;
  }
  button.link:hover { color: var(--accent); background: transparent; }

  .oauth-buttons { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
  .oauth { display: flex; align-items: center; gap: 10px; padding: 8px 12px; }
  .oauth-icon {
    width: 20px; height: 20px;
    display: inline-flex; align-items: center; justify-content: center;
    font-weight: 700; font-size: 14px;
    border-radius: 50%;
    background: var(--bg-elevated);
  }
  .divider {
    display: flex; align-items: center; gap: 8px;
    color: var(--text-muted); font-size: 11px;
    margin: 12px 0;
  }
  .divider::before, .divider::after {
    content: ""; flex: 1; height: 1px;
    background: var(--border-default);
  }

  .field {
    display: flex; flex-direction: column; gap: 4px;
    margin-bottom: 10px;
  }
  .field .label { font-size: 12px; color: var(--text-muted); }
  .field input {
    padding: 6px 10px;
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    background: var(--bg-input);
    color: var(--text-primary);
    font-size: 13px;
  }
  .field input:focus {
    outline: none;
    border-color: var(--accent);
  }
  .msg {
    font-size: 12px; padding: 6px 10px;
    border-radius: 4px; margin: 6px 0;
  }
  .msg.err { background: var(--danger-bg); color: var(--danger); }
  .loading { padding: 30px; text-align: center; color: var(--text-muted); }
</style>
