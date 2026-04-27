<script lang="ts">
  import { t } from "./i18n.svelte.js";
  import {
    addJiraSource,
    addGithubSource,
    clearGithubPat,
    clearJiraOauthClient,
    cloneGithubRepo,
    cloudBillingCheckout,
    cloudBillingPortal,
    cloudLogin,
    cloudLogout,
    cloudSignup,
    deleteSource,
    fetchCloudStatus,
    fetchGithubOauthConfig,
    fetchGithubStatus,
    fetchJiraOauthConfig,
    listGithubRepos,
    listSources,
    pollGithubDeviceFlow,
    pollJiraOauthStatus,
    saveGithubOauthClientId,
    saveJiraOauthClient,
    setGithubPat,
    startGithubDeviceFlow,
    startJiraOauth,
    syncSource,
    testJira,
    type CloudStatus,
    type GithubDeviceStart,
    type GithubOauthConfig,
    type GithubRepoSummary,
    type GithubStatus,
    type JiraOauthConfig,
    type SourceSummary,
    type SyncResult,
  } from "./api.js";
  import { onDestroy } from "svelte";

  interface Props {
    onClose: () => void;
    onChanged?: () => void;
  }

  let { onClose, onChanged }: Props = $props();

  let tab = $state<"account" | "github" | "jira" | "sources">("account");

  // Cloud account state
  let cloudStatus = $state<CloudStatus | null>(null);
  let cloudMode = $state<"signin" | "signup">("signin");
  let cloudEmail = $state("");
  let cloudPassword = $state("");
  let cloudBusy = $state(false);
  let cloudError = $state<string | null>(null);

  async function loadCloudStatus() {
    try {
      cloudStatus = await fetchCloudStatus();
      if (cloudStatus.signed_in && tab === "account") {
        // Stay on account tab so user sees the connected state.
      } else if (!cloudStatus.signed_in) {
        tab = "account";
      }
    } catch {
      // Ignore — local server might just be starting.
    }
  }

  function mapCloudError(error: string | undefined): string {
    if (!error) return "";
    if (error === "invalid_credentials") return t("account.error.invalid_credentials");
    if (error === "invalid_input") return t("account.error.invalid_input");
    if (error === "cloud_unreachable") return t("account.error.cloud_unreachable");
    return error;
  }

  async function submitCloudAuth() {
    cloudBusy = true;
    cloudError = null;
    try {
      const fn = cloudMode === "signup" ? cloudSignup : cloudLogin;
      const result = await fn({ email: cloudEmail.trim(), password: cloudPassword });
      if (!result.ok) {
        if (result.error === "invalid_input" && cloudMode === "signup") {
          // Devise validation error — usually email taken
          cloudError = t("account.error.email_taken");
        } else {
          cloudError = mapCloudError(result.error);
        }
        return;
      }
      cloudPassword = "";
      await loadCloudStatus();
      // Cloud sign-in unlocks GitHub/Jira; reload their configs too.
      await loadGhStatus();
      await loadJiraOauthConfig();
    } catch (err) {
      cloudError = err instanceof Error ? err.message : String(err);
    } finally {
      cloudBusy = false;
    }
  }

  async function handleCloudLogout() {
    await cloudLogout();
    await loadCloudStatus();
    await loadGhStatus();
    await loadJiraOauthConfig();
  }

  let billingBusy = $state(false);
  let billingError = $state<string | null>(null);

  async function handleUpgrade() {
    billingBusy = true;
    billingError = null;
    try {
      const result = await cloudBillingCheckout("monthly");
      if (result.url) {
        openInNewTab(result.url);
      } else {
        billingError = result.error ?? "checkout_failed";
      }
    } catch (err) {
      billingError = err instanceof Error ? err.message : String(err);
    } finally {
      billingBusy = false;
    }
  }

  async function handleManageBilling() {
    billingBusy = true;
    billingError = null;
    try {
      const result = await cloudBillingPortal();
      if (result.url) {
        openInNewTab(result.url);
      } else {
        billingError = result.error ?? "portal_failed";
      }
    } catch (err) {
      billingError = err instanceof Error ? err.message : String(err);
    } finally {
      billingBusy = false;
    }
  }

  // GitHub state
  let ghStatus = $state<GithubStatus | null>(null);
  let ghOauthConfig = $state<GithubOauthConfig | null>(null);
  let ghToken = $state("");
  let ghConnecting = $state(false);
  let ghError = $state<string | null>(null);
  let ghRepos = $state<GithubRepoSummary[]>([]);
  let ghLoading = $state(false);
  let ghFilter = $state("");
  let ghCloning = $state<string | null>(null);
  let ghMessage = $state<string | null>(null);
  let ghShowTokenForm = $state(false);

  // Device-flow state
  let ghDevice = $state<GithubDeviceStart | null>(null);
  let ghDevicePolling = $state(false);
  let ghDeviceTimer: ReturnType<typeof setInterval> | null = null;

  // OAuth-config form state (paste client_id from GitHub OAuth App)
  let ghShowOauthConfig = $state(false);
  let ghClientIdInput = $state("");
  let ghSavingClient = $state(false);

  onDestroy(() => {
    if (ghDeviceTimer) clearInterval(ghDeviceTimer);
    if (jiraOauthTimer) clearInterval(jiraOauthTimer);
  });

  // Jira state
  let jiraBaseUrl = $state("");
  let jiraEmail = $state("");
  let jiraToken = $state("");
  let jiraJql = $state("");
  let jiraSourceId = $state("");
  let jiraTesting = $state(false);
  let jiraAdding = $state(false);
  let jiraError = $state<string | null>(null);
  let jiraTestMessage = $state<string | null>(null);

  // Jira OAuth state
  let jiraOauthConfig = $state<JiraOauthConfig | null>(null);
  let jiraShowOauthConfig = $state(false);
  let jiraClientIdInput = $state("");
  let jiraClientSecretInput = $state("");
  let jiraSavingClient = $state(false);
  let jiraOauthState = $state<string | null>(null);
  let jiraOauthMessage = $state<string | null>(null);
  let jiraOauthTimer: ReturnType<typeof setInterval> | null = null;

  // Sources state
  let sources = $state<SourceSummary[]>([]);
  let sourcesLoading = $state(false);
  let syncingId = $state<string | null>(null);
  let syncMessage = $state<string | null>(null);

  const filteredRepos = $derived(
    ghFilter
      ? ghRepos.filter((r) => r.full_name.toLowerCase().includes(ghFilter.toLowerCase()))
      : ghRepos,
  );

  async function loadGhStatus() {
    try {
      const [status, config] = await Promise.all([fetchGithubStatus(), fetchGithubOauthConfig()]);
      ghStatus = status;
      ghOauthConfig = config;
    } catch (err) {
      ghError = err instanceof Error ? err.message : String(err);
    }
  }

  function openInNewTab(url: string) {
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function startDeviceFlow() {
    ghError = null;
    try {
      ghDevice = await startGithubDeviceFlow();
      // Open the GitHub verification page in a new tab so the user can paste the code.
      openInNewTab(ghDevice.verification_uri);
      ghDevicePolling = true;
      const intervalMs = Math.max(ghDevice.interval, 5) * 1000;
      ghDeviceTimer = setInterval(() => pollDeviceFlow(), intervalMs);
    } catch (err) {
      ghError = err instanceof Error ? err.message : String(err);
    }
  }

  function stopDeviceFlow() {
    if (ghDeviceTimer) {
      clearInterval(ghDeviceTimer);
      ghDeviceTimer = null;
    }
    ghDevice = null;
    ghDevicePolling = false;
  }

  async function pollDeviceFlow() {
    if (!ghDevice) return;
    try {
      const result = await pollGithubDeviceFlow(ghDevice.device_code);
      if (result.status === "ok") {
        ghMessage = t("integrations.github.oauth.success", { login: result.login });
        stopDeviceFlow();
        await loadGhStatus();
      } else if (result.status === "pending") {
        // keep polling
      } else {
        ghError = ("detail" in result && result.detail) ? result.detail : `error: ${result.error}`;
        stopDeviceFlow();
      }
    } catch (err) {
      ghError = err instanceof Error ? err.message : String(err);
      stopDeviceFlow();
    }
  }

  async function copyDeviceCode() {
    if (!ghDevice) return;
    try {
      await navigator.clipboard.writeText(ghDevice.user_code);
    } catch {
      // ignore
    }
  }

  async function saveGhClientId() {
    if (!ghClientIdInput.trim()) return;
    ghSavingClient = true;
    ghError = null;
    try {
      await saveGithubOauthClientId(ghClientIdInput.trim());
      ghClientIdInput = "";
      ghShowOauthConfig = false;
      await loadGhStatus();
    } catch (err) {
      ghError = err instanceof Error ? err.message : String(err);
    } finally {
      ghSavingClient = false;
    }
  }

  // Jira OAuth -------------------------------------------------------

  async function loadJiraOauthConfig() {
    try {
      jiraOauthConfig = await fetchJiraOauthConfig();
    } catch {
      // ignore
    }
  }

  async function saveJiraClient() {
    if (!jiraClientIdInput.trim() || !jiraClientSecretInput.trim()) return;
    jiraSavingClient = true;
    jiraError = null;
    try {
      await saveJiraOauthClient({
        client_id: jiraClientIdInput.trim(),
        client_secret: jiraClientSecretInput.trim(),
      });
      jiraClientIdInput = "";
      jiraClientSecretInput = "";
      jiraShowOauthConfig = false;
      await loadJiraOauthConfig();
    } catch (err) {
      jiraError = err instanceof Error ? err.message : String(err);
    } finally {
      jiraSavingClient = false;
    }
  }

  async function clearJiraClient() {
    await clearJiraOauthClient();
    await loadJiraOauthConfig();
  }

  async function startJiraConnect() {
    jiraError = null;
    jiraOauthMessage = null;
    try {
      const result = await startJiraOauth();
      jiraOauthState = result.state;
      openInNewTab(result.authorize_url);
      jiraOauthTimer = setInterval(() => pollJira(), 2500);
    } catch (err) {
      jiraError = err instanceof Error ? err.message : String(err);
    }
  }

  function stopJiraConnect() {
    if (jiraOauthTimer) {
      clearInterval(jiraOauthTimer);
      jiraOauthTimer = null;
    }
    jiraOauthState = null;
  }

  async function pollJira() {
    if (!jiraOauthState) return;
    const status = await pollJiraOauthStatus(jiraOauthState);
    if (status.status === "ok") {
      jiraOauthMessage = t("integrations.jira.oauth.success", { site: status.display_name });
      stopJiraConnect();
      await loadSources();
      onChanged?.();
    } else if (status.status === "failed" || status.status === "expired") {
      jiraError = status.status === "failed" && status.detail ? status.detail : status.status;
      stopJiraConnect();
    }
  }

  async function loadSources() {
    sourcesLoading = true;
    try {
      sources = await listSources();
    } catch {
      // ignore
    } finally {
      sourcesLoading = false;
    }
  }

  async function connectGh() {
    if (!ghToken.trim()) return;
    ghConnecting = true;
    ghError = null;
    try {
      const result = await setGithubPat(ghToken.trim());
      ghMessage = `✓ ${result.login}`;
      ghToken = "";
      await loadGhStatus();
    } catch (err) {
      ghError = err instanceof Error ? err.message : String(err);
    } finally {
      ghConnecting = false;
    }
  }

  async function disconnectGh() {
    await clearGithubPat();
    ghStatus = { connected: false, token_hint: null };
    ghRepos = [];
  }

  async function refreshRepos() {
    ghLoading = true;
    ghError = null;
    try {
      ghRepos = await listGithubRepos();
    } catch (err) {
      ghError = err instanceof Error ? err.message : String(err);
    } finally {
      ghLoading = false;
    }
  }

  async function cloneRepo(repo: GithubRepoSummary) {
    ghCloning = repo.full_name;
    ghError = null;
    try {
      await cloneGithubRepo({ full_name: repo.full_name, default_branch: repo.default_branch });
      ghMessage = t("integrations.github.cloned_success", { repo: repo.full_name });
      onChanged?.();
    } catch (err) {
      ghError = err instanceof Error ? err.message : String(err);
    } finally {
      ghCloning = null;
    }
  }

  async function trackRepoIssues(repo: GithubRepoSummary) {
    ghCloning = repo.full_name;
    ghError = null;
    try {
      await addGithubSource({ id: `gh-${repo.full_name.replace("/", "-")}`, repo: repo.full_name });
      ghMessage = `✓ ${repo.full_name}`;
      await loadSources();
      onChanged?.();
    } catch (err) {
      ghError = err instanceof Error ? err.message : String(err);
    } finally {
      ghCloning = null;
    }
  }

  async function jiraTestNow() {
    if (!jiraBaseUrl || !jiraEmail || !jiraToken) return;
    jiraTesting = true;
    jiraError = null;
    jiraTestMessage = null;
    try {
      const result = await testJira({ base_url: jiraBaseUrl, email: jiraEmail, api_token: jiraToken });
      jiraTestMessage = t("integrations.jira.test_success", { name: result.display_name });
    } catch (err) {
      jiraError = err instanceof Error ? err.message : String(err);
    } finally {
      jiraTesting = false;
    }
  }

  async function jiraAddNow() {
    if (!jiraBaseUrl || !jiraEmail || !jiraToken || !jiraSourceId) return;
    jiraAdding = true;
    jiraError = null;
    try {
      const input: Parameters<typeof addJiraSource>[0] = {
        id: jiraSourceId,
        base_url: jiraBaseUrl,
        email: jiraEmail,
        api_token: jiraToken,
      };
      if (jiraJql) input.jql = jiraJql;
      await addJiraSource(input);
      jiraTestMessage = `✓ ${jiraSourceId}`;
      jiraBaseUrl = "";
      jiraEmail = "";
      jiraToken = "";
      jiraJql = "";
      jiraSourceId = "";
      await loadSources();
      onChanged?.();
    } catch (err) {
      jiraError = err instanceof Error ? err.message : String(err);
    } finally {
      jiraAdding = false;
    }
  }

  async function syncNow(id: string) {
    syncingId = id;
    syncMessage = null;
    try {
      const result: SyncResult = await syncSource(id);
      syncMessage = t("integrations.sources.sync_result", {
        created: result.created,
        skipped: result.skipped,
        total: result.pulled_total,
      });
      onChanged?.();
    } catch (err) {
      syncMessage = err instanceof Error ? err.message : String(err);
    } finally {
      syncingId = null;
    }
  }

  async function deleteNow(id: string) {
    if (!confirm(`Supprimer la source "${id}" ?`)) return;
    try {
      await deleteSource(id);
      await loadSources();
    } catch {
      // ignore
    }
  }

  loadGhStatus();
  loadJiraOauthConfig();
  loadCloudStatus();
  loadSources();
</script>

<div class="backdrop" onclick={onClose} role="presentation">
  <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
    <header>
      <div class="title-block">
        <h2>{t("integrations.title")}</h2>
        <div class="tabs">
          <button class="tab" class:active={tab === "account"} onclick={() => (tab = "account")}>
            {t("account.tab")}{cloudStatus?.signed_in ? " ✓" : ""}
          </button>
          <button class="tab" class:active={tab === "github"} onclick={() => (tab = "github")}>
            {t("integrations.tab.github")}
          </button>
          <button class="tab" class:active={tab === "jira"} onclick={() => (tab = "jira")}>
            {t("integrations.tab.jira")}
          </button>
          <button class="tab" class:active={tab === "sources"} onclick={() => (tab = "sources")}>
            {t("integrations.tab.sources")} ({sources.length})
          </button>
        </div>
      </div>
      <button class="close" onclick={onClose}>✕</button>
    </header>

    <div class="content">
      {#if tab === "account"}
        <section class="panel">
          {#if cloudStatus?.signed_in && cloudStatus.user}
            <div class="status ok">
              {t("account.signed_in_as", { email: cloudStatus.user.email })}
            </div>
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
                  <span
                    class:over={cloudStatus.user.repos_used >= cloudStatus.user.repos_limit}
                  >{t("account.repos_quota", {
                    used: cloudStatus.user.repos_used,
                    limit: cloudStatus.user.repos_limit,
                  })}</span>
                {/if}
              </div>
            </div>
            <div class="row">
              {#if cloudStatus.user.plan === "free"}
                <button class="primary" onclick={handleUpgrade} disabled={billingBusy}>
                  {billingBusy ? t("account.button.upgrading") : t("account.button.upgrade")}
                </button>
              {:else}
                <button onclick={handleManageBilling} disabled={billingBusy}>
                  {billingBusy ? t("account.button.opening_portal") : t("account.button.manage_billing")}
                </button>
              {/if}
              <button onclick={handleCloudLogout}>{t("account.button.logout")}</button>
            </div>
            {#if billingError}<div class="msg err">{billingError}</div>{/if}
          {:else}
            <div class="status">{t("account.signed_out")}</div>
            <label class="field">
              <span class="label">{t("account.email")}</span>
              <input type="email" bind:value={cloudEmail} autocomplete="email" />
            </label>
            <label class="field">
              <span class="label">{t("account.password")}</span>
              <input type="password" bind:value={cloudPassword} autocomplete={cloudMode === "signup" ? "new-password" : "current-password"} />
            </label>
            {#if cloudError}<div class="msg err">{cloudError}</div>{/if}
            <div class="row connect-actions">
              <button
                class="primary"
                onclick={submitCloudAuth}
                disabled={cloudBusy || !cloudEmail || cloudPassword.length < 8}
              >
                {#if cloudMode === "signup"}
                  {cloudBusy ? t("account.button.signing_up") : t("account.button.signup")}
                {:else}
                  {cloudBusy ? t("account.button.signing_in") : t("account.button.signin")}
                {/if}
              </button>
              <button
                class="link"
                onclick={() => {
                  cloudMode = cloudMode === "signup" ? "signin" : "signup";
                  cloudError = null;
                }}
              >
                {cloudMode === "signup" ? t("account.toggle_signin") : t("account.toggle_signup")}
              </button>
            </div>
          {/if}
        </section>
      {:else if tab === "github"}
        <section class="panel">
          {#if !cloudStatus?.signed_in}
            <div class="signin-banner">
              <p>{t("account.signin_required")}</p>
              <button class="primary" onclick={() => (tab = "account")}>
                {t("account.button.signin")}
              </button>
            </div>
          {/if}
          {#if ghStatus?.connected}
            <div class="status ok">
              {t("integrations.github.connected", { login: ghStatus.token_hint ?? "?" })}
              <button class="link" onclick={disconnectGh}>{t("integrations.github.button.disconnect")}</button>
            </div>
          {:else if ghDevice}
            <div class="device-flow">
              <h3>{t("integrations.github.oauth.title")}</h3>
              <p>{t("integrations.github.oauth.code_label")}</p>
              <button class="device-code" onclick={copyDeviceCode} title="copy">
                {ghDevice.user_code}
              </button>
              <div class="row">
                <button class="primary" onclick={() => openInNewTab(ghDevice!.verification_uri)}>
                  {t("integrations.github.oauth.open")}
                </button>
                <button onclick={stopDeviceFlow}>{t("integrations.github.oauth.cancel")}</button>
              </div>
              {#if ghDevicePolling}
                <div class="muted polling">⟳ {t("integrations.github.oauth.waiting")}</div>
              {/if}
            </div>
          {:else}
            <div class="status">{t("integrations.github.not_connected")}</div>
            <div class="row connect-actions">
              <button
                class="primary"
                onclick={startDeviceFlow}
                disabled={!ghOauthConfig?.device_flow_available}
                title={ghOauthConfig?.device_flow_available ? "" : "Configurez d'abord un Client ID"}
              >
                {t("integrations.github.button.connect_oauth")}
              </button>
              {#if ghOauthConfig}
                <button onclick={() => openInNewTab(ghOauthConfig!.pat_url)}>
                  {t("integrations.github.button.create_token")}
                </button>
              {/if}
              <button class="link" onclick={() => (ghShowOauthConfig = !ghShowOauthConfig)}>
                ⚙ {t("integrations.github.oauth.configure")}
              </button>
              <button class="link" onclick={() => (ghShowTokenForm = !ghShowTokenForm)}>
                {ghShowTokenForm ? "↑" : "↓"} {t("integrations.github.button.connect")}
              </button>
            </div>
            {#if ghOauthConfig?.client_id_hint}
              <div class="muted small">
                {t("integrations.github.oauth.configured_hint", { hint: ghOauthConfig.client_id_hint })}
                {#if ghOauthConfig.client_id_source === "cloud"}
                  · via backlog.so
                {:else if ghOauthConfig.client_id_source === "user"}
                  · custom
                {:else if ghOauthConfig.client_id_source === "env"}
                  · env
                {/if}
              </div>
            {/if}
            {#if ghShowOauthConfig}
              <div class="config-panel guide">
                <div class="guide-header">
                  <h4>{t("integrations.github.oauth.guide.title")}</h4>
                  <p class="muted small">{t("integrations.github.oauth.guide.subtitle")}</p>
                </div>
                <ol class="steps">
                  <li>
                    <strong>{t("integrations.github.oauth.guide.step1.title")}</strong>
                    <p>{t("integrations.github.oauth.guide.step1.body")}</p>
                    <button
                      class="primary"
                      onclick={() => openInNewTab(ghOauthConfig?.register_url ?? "https://github.com/settings/applications/new")}
                    >
                      ↗ {t("integrations.github.oauth.guide.step1.cta")}
                    </button>
                  </li>
                  <li>
                    <strong>{t("integrations.github.oauth.guide.step2.title")}</strong>
                    <ul class="hints">
                      <li><code>Application name</code> — Backlog (or any name)</li>
                      <li><code>Homepage URL</code> — http://localhost:7878 (or any URL)</li>
                      <li><code>Authorization callback URL</code> — http://localhost:7878 (required by GitHub but unused for Device Flow)</li>
                      <li><code>Enable Device Flow</code> — ☑️ <strong>{t("integrations.github.oauth.guide.must_check")}</strong></li>
                    </ul>
                  </li>
                  <li>
                    <strong>{t("integrations.github.oauth.guide.step3.title")}</strong>
                    <p>{t("integrations.github.oauth.guide.step3.body")}</p>
                  </li>
                  <li>
                    <strong>{t("integrations.github.oauth.guide.step4.title")}</strong>
                    <label class="field">
                      <input
                        type="text"
                        bind:value={ghClientIdInput}
                        placeholder="Iv1.…  ou  Ov23li…"
                        autocomplete="off"
                      />
                    </label>
                  </li>
                </ol>
                <div class="row">
                  <button
                    class="primary"
                    onclick={saveGhClientId}
                    disabled={ghSavingClient || !ghClientIdInput.trim()}
                  >
                    {ghSavingClient
                      ? t("integrations.github.oauth.saving")
                      : t("integrations.github.oauth.save")}
                  </button>
                  {#if ghOauthConfig}
                    <button onclick={() => openInNewTab(ghOauthConfig!.register_url)}>
                      ↗ {t("integrations.github.oauth.register_button")}
                    </button>
                  {/if}
                </div>
              </div>
            {/if}
            {#if ghShowTokenForm}
              <label class="field">
                <span class="label">{t("integrations.github.pat_label")}</span>
                <input type="password" bind:value={ghToken} placeholder="ghp_…" autocomplete="off" />
                <small>{t("integrations.github.pat_help")}</small>
              </label>
              <button class="primary" onclick={connectGh} disabled={ghConnecting || !ghToken}>
                {ghConnecting ? t("integrations.github.button.connecting") : t("integrations.github.button.connect")}
              </button>
            {/if}
          {/if}

          {#if ghStatus?.connected}
            <hr />
            <div class="row">
              <button onclick={refreshRepos} disabled={ghLoading}>
                {ghLoading ? t("integrations.github.button.listing") : t("integrations.github.button.list_repos")}
              </button>
              {#if ghRepos.length > 0}
                <input
                  class="filter"
                  type="search"
                  bind:value={ghFilter}
                  placeholder={t("integrations.github.search_placeholder")}
                />
                <span class="muted">{t("integrations.github.repos_count", { count: filteredRepos.length })}</span>
              {/if}
            </div>
            {#if ghRepos.length > 0}
              <ul class="repos">
                {#each filteredRepos as repo (repo.full_name)}
                  <li>
                    <div class="repo-line">
                      <a href={repo.html_url} target="_blank" rel="noopener noreferrer" class="repo-name">
                        {repo.full_name}
                      </a>
                      {#if repo.private}
                        <span class="badge">{t("integrations.github.private_badge")}</span>
                      {/if}
                      <span class="branch">{repo.default_branch}</span>
                    </div>
                    {#if repo.description}<div class="desc">{repo.description}</div>{/if}
                    <div class="actions">
                      <button onclick={() => cloneRepo(repo)} disabled={ghCloning === repo.full_name}>
                        {ghCloning === repo.full_name ? t("integrations.github.button.cloning") : t("integrations.github.button.clone")}
                      </button>
                      <button class="ghost" onclick={() => trackRepoIssues(repo)} disabled={ghCloning === repo.full_name}>
                        {t("integrations.github.button.add_source")}
                      </button>
                    </div>
                  </li>
                {/each}
              </ul>
            {/if}
          {/if}
          {#if ghMessage}<div class="msg ok">{ghMessage}</div>{/if}
          {#if ghError}<div class="msg err">{ghError}</div>{/if}
        </section>
      {:else if tab === "jira"}
        <section class="panel">
          {#if !cloudStatus?.signed_in}
            <div class="signin-banner">
              <p>{t("account.signin_required")}</p>
              <button class="primary" onclick={() => (tab = "account")}>
                {t("account.button.signin")}
              </button>
            </div>
          {/if}
          {#if jiraOauthConfig?.connected}
            <div class="status ok">
              ✓ Connecté à {jiraOauthConfig.site_url ?? "Jira"}
            </div>
          {/if}
          <div class="row connect-actions">
            <button
              class="primary"
              onclick={startJiraConnect}
              disabled={jiraOauthState !== null}
            >
              {t("integrations.jira.oauth.connect")}
            </button>
            <button class="link" onclick={() => (jiraShowOauthConfig = !jiraShowOauthConfig)}>
              ⚙ {t("integrations.jira.oauth.configure")}
            </button>
          </div>
          {#if jiraOauthConfig}
            <div class="muted small">
              {#if jiraOauthConfig.mode === "cloud"}
                via backlog.so · zéro config
              {:else if jiraOauthConfig.client_id_hint}
                {t("integrations.jira.oauth.configured_hint", { hint: jiraOauthConfig.client_id_hint })}
                · custom
                <button class="link inline" onclick={clearJiraClient}>↺ reset</button>
              {/if}
            </div>
          {/if}
          {#if jiraOauthState !== null}
            <div class="device-flow">
              <p>⟳ {t("integrations.jira.oauth.waiting")}</p>
              <button onclick={stopJiraConnect}>{t("integrations.jira.oauth.cancel")}</button>
            </div>
          {/if}
          {#if jiraOauthMessage}<div class="msg ok">{jiraOauthMessage}</div>{/if}
          {#if jiraShowOauthConfig}
            <div class="config-panel guide">
              <div class="guide-header">
                <h4>{t("integrations.jira.oauth.guide.title")}</h4>
                <p class="muted small">{t("integrations.jira.oauth.guide.subtitle")}</p>
              </div>
              <ol class="steps">
                <li>
                  <strong>{t("integrations.jira.oauth.guide.step1.title")}</strong>
                  <p>{t("integrations.jira.oauth.guide.step1.body")}</p>
                  <button
                    class="primary"
                    onclick={() => openInNewTab(jiraOauthConfig?.register_url ?? "https://developer.atlassian.com/console/myapps/")}
                  >
                    ↗ {t("integrations.jira.oauth.guide.step1.cta")}
                  </button>
                </li>
                <li>
                  <strong>{t("integrations.jira.oauth.guide.step2.title")}</strong>
                  <p>{t("integrations.jira.oauth.guide.step2.body")}</p>
                </li>
                <li>
                  <strong>{t("integrations.jira.oauth.guide.step3.title")}</strong>
                  <p>{t("integrations.jira.oauth.guide.step3.body")}</p>
                  <ul class="hints">
                    <li><code>read:jira-work</code></li>
                    <li><code>read:jira-user</code></li>
                    <li><code>offline_access</code> ({t("integrations.jira.oauth.guide.optional")})</li>
                  </ul>
                </li>
                <li>
                  <strong>{t("integrations.jira.oauth.guide.step4.title")}</strong>
                  <p>{t("integrations.jira.oauth.guide.step4.body")}</p>
                  <code class="callback-url">{typeof window !== "undefined"
                    ? `${window.location.origin}/api/v1/integrations/jira/oauth/callback`
                    : "/api/v1/integrations/jira/oauth/callback"}</code>
                </li>
                <li>
                  <strong>{t("integrations.jira.oauth.guide.step5.title")}</strong>
                  <p>{t("integrations.jira.oauth.guide.step5.body")}</p>
                  <label class="field">
                    <span class="label">{t("integrations.jira.oauth.client_id_label")}</span>
                    <input type="text" bind:value={jiraClientIdInput} autocomplete="off" />
                  </label>
                  <label class="field">
                    <span class="label">{t("integrations.jira.oauth.client_secret_label")}</span>
                    <input type="password" bind:value={jiraClientSecretInput} autocomplete="off" />
                  </label>
                </li>
              </ol>
              <div class="row">
                <button
                  class="primary"
                  onclick={saveJiraClient}
                  disabled={jiraSavingClient || !jiraClientIdInput.trim() || !jiraClientSecretInput.trim()}
                >
                  {jiraSavingClient
                    ? t("integrations.github.oauth.saving")
                    : t("integrations.github.oauth.save")}
                </button>
                {#if jiraOauthConfig}
                  <button onclick={() => openInNewTab(jiraOauthConfig!.register_url)}>
                    {t("integrations.jira.oauth.register_button")}
                  </button>
                {/if}
              </div>
            </div>
          {/if}
          <hr />
          <label class="field">
            <span class="label">{t("integrations.jira.base_url")}</span>
            <input type="url" bind:value={jiraBaseUrl} placeholder="https://your-org.atlassian.net" />
          </label>
          <label class="field">
            <span class="label">{t("integrations.jira.email")}</span>
            <input type="email" bind:value={jiraEmail} />
          </label>
          <label class="field">
            <span class="label">{t("integrations.jira.api_token")}</span>
            <input type="password" bind:value={jiraToken} autocomplete="off" />
            <small>{t("integrations.jira.api_token_help")}</small>
            <button
              class="link inline"
              onclick={() => openInNewTab("https://id.atlassian.com/manage-profile/security/api-tokens")}
            >
              ↗ {t("integrations.jira.button.create_token")}
            </button>
          </label>
          <label class="field">
            <span class="label">{t("integrations.jira.jql")}</span>
            <input
              type="text"
              bind:value={jiraJql}
              placeholder={t("integrations.jira.jql_placeholder")}
            />
          </label>
          <label class="field">
            <span class="label">{t("integrations.jira.source_id")}</span>
            <input type="text" bind:value={jiraSourceId} placeholder="acme-jira" />
            <small>{t("integrations.jira.source_id_help")}</small>
          </label>
          <div class="row">
            <button onclick={jiraTestNow} disabled={jiraTesting || !jiraBaseUrl || !jiraEmail || !jiraToken}>
              {jiraTesting ? t("integrations.jira.button.testing") : t("integrations.jira.button.test")}
            </button>
            <button
              class="primary"
              onclick={jiraAddNow}
              disabled={jiraAdding || !jiraBaseUrl || !jiraEmail || !jiraToken || !jiraSourceId}
            >
              {jiraAdding ? t("integrations.jira.button.adding") : t("integrations.jira.button.add")}
            </button>
          </div>
          {#if jiraTestMessage}<div class="msg ok">{jiraTestMessage}</div>{/if}
          {#if jiraError}<div class="msg err">{jiraError}</div>{/if}
        </section>
      {:else}
        <section class="panel">
          {#if sourcesLoading}
            <div class="loading">…</div>
          {:else if sources.length === 0}
            <div class="empty">{t("integrations.sources.empty")}</div>
          {:else}
            <ul class="sources">
              {#each sources as source (source.id)}
                <li>
                  <div class="src-line">
                    <strong>{source.id}</strong>
                    <span class="badge">{source.kind}</span>
                    {#if !source.enabled}<span class="muted">disabled</span>{/if}
                  </div>
                  <div class="actions">
                    <button onclick={() => syncNow(source.id)} disabled={syncingId === source.id}>
                      {syncingId === source.id ? t("integrations.sources.button.syncing") : t("integrations.sources.button.sync")}
                    </button>
                    <button class="ghost danger" onclick={() => deleteNow(source.id)}>
                      {t("integrations.sources.button.delete")}
                    </button>
                  </div>
                </li>
              {/each}
            </ul>
          {/if}
          {#if syncMessage}<div class="msg">{syncMessage}</div>{/if}
        </section>
      {/if}
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(16, 24, 40, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }
  .modal {
    background: white;
    border-radius: 8px;
    box-shadow: 0 20px 24px rgba(16, 24, 40, 0.18);
    max-width: 720px;
    width: 92%;
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  header {
    padding: 16px 20px;
    border-bottom: 1px solid #e4e7ec;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .title-block { display: flex; align-items: center; gap: 12px; flex: 1; }
  h2 { margin: 0; font-size: 16px; }
  .tabs {
    display: flex;
    gap: 4px;
    background: #f2f4f7;
    border-radius: 6px;
    padding: 2px;
  }
  .tab {
    background: transparent;
    border: none;
    padding: 4px 10px;
    cursor: pointer;
    font-size: 12px;
    color: #475467;
    border-radius: 4px;
  }
  .tab.active {
    background: white;
    color: #1d2939;
    box-shadow: 0 1px 2px rgba(16, 24, 40, 0.08);
  }
  .close {
    background: transparent;
    border: none;
    font-size: 18px;
    cursor: pointer;
    color: #475467;
  }
  .content { padding: 16px 20px; overflow-y: auto; flex: 1; }
  .panel { display: flex; flex-direction: column; gap: 12px; }
  .field { display: flex; flex-direction: column; gap: 4px; }
  .label { font-size: 12px; color: #475467; font-weight: 500; }
  input {
    border: 1px solid #d0d5dd;
    border-radius: 4px;
    padding: 6px 10px;
    font-size: 13px;
    font-family: inherit;
  }
  small { color: #98a2b3; font-size: 11px; }
  hr { border: none; border-top: 1px solid #e4e7ec; margin: 4px 0; }
  .status { color: #1d2939; font-size: 13px; }
  .status.ok { color: #027a48; display: flex; gap: 12px; align-items: center; }
  .row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .filter { flex: 1; min-width: 180px; }
  .muted { color: #98a2b3; font-size: 12px; }
  button {
    background: #f2f4f7;
    border: 1px solid #d0d5dd;
    border-radius: 4px;
    padding: 4px 12px;
    cursor: pointer;
    font-size: 13px;
  }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  button.primary { background: #1570ef; color: white; border-color: #1570ef; }
  button.primary:hover:not(:disabled) { background: #155eef; }
  button.ghost { background: transparent; }
  button.ghost.danger { color: #b42318; border-color: #fcd9d6; }
  button.link {
    background: transparent;
    border: none;
    color: #1570ef;
    text-decoration: underline;
    padding: 0;
  }
  .repos, .sources { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .repos > li, .sources > li {
    border: 1px solid #e4e7ec;
    border-radius: 4px;
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .repo-line, .src-line { display: flex; align-items: center; gap: 8px; }
  .repo-name {
    color: #1570ef;
    text-decoration: none;
    font-weight: 500;
  }
  .repo-name:hover { text-decoration: underline; }
  .badge {
    background: #f2f4f7;
    color: #475467;
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 10px;
    text-transform: uppercase;
  }
  .branch { font-family: ui-monospace, monospace; font-size: 11px; color: #98a2b3; }
  .desc { font-size: 12px; color: #475467; }
  .actions { display: flex; gap: 6px; }
  .msg { font-size: 12px; padding: 6px 10px; border-radius: 4px; }
  .msg.ok { background: #d1fadf; color: #027a48; }
  .msg.err { background: #fef0c7; color: #b54708; }
  .empty { padding: 16px; text-align: center; color: #667085; }
  .loading { padding: 16px; text-align: center; color: #667085; }
  .connect-actions { gap: 8px; flex-wrap: wrap; }
  .device-flow {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
    border: 1px solid #d6bbfb;
    border-radius: 6px;
    background: #faf5ff;
  }
  .device-flow h3 { margin: 0; font-size: 14px; color: #5925dc; }
  .device-flow p { margin: 0; font-size: 12px; color: #475467; }
  .device-code {
    align-self: flex-start;
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 22px;
    letter-spacing: 0.18em;
    font-weight: 600;
    color: #1d2939;
    background: white;
    border: 1px dashed #d6bbfb;
    border-radius: 6px;
    padding: 6px 14px;
    cursor: pointer;
  }
  .device-code:hover { background: #f9fafb; }
  .polling {
    font-size: 12px;
    color: #6941c6;
  }
  button.link.inline {
    align-self: flex-start;
    padding: 0;
    font-size: 11px;
    margin-top: 2px;
  }
  .config-panel {
    border: 1px solid #e4e7ec;
    border-radius: 6px;
    padding: 12px;
    background: #f9fafb;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .config-panel.guide { padding: 16px; gap: 14px; }
  .guide-header h4 { margin: 0 0 4px; font-size: 14px; color: #1d2939; }
  .guide-header .muted { margin: 0; }
  .steps {
    list-style: none;
    counter-reset: step;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .steps > li {
    padding: 10px 12px;
    background: white;
    border: 1px solid #e4e7ec;
    border-radius: 6px;
    font-size: 13px;
    line-height: 1.45;
  }
  .steps > li > strong { display: block; margin-bottom: 4px; color: #1d2939; }
  .steps > li > p { margin: 0 0 8px; color: #475467; font-size: 12px; }
  .steps > li > .field { margin-top: 8px; }
  .steps > li button.primary { margin-top: 4px; }
  .hints {
    list-style: disc;
    padding-left: 20px;
    margin: 6px 0 0;
    color: #475467;
    font-size: 12px;
  }
  .hints code {
    background: #f2f4f7;
    padding: 1px 6px;
    border-radius: 3px;
    font-family: ui-monospace, monospace;
    font-size: 11px;
  }
  .callback-url {
    display: block;
    padding: 8px 10px;
    background: #f2f4f7;
    border-radius: 4px;
    font-family: ui-monospace, monospace;
    font-size: 11px;
    word-break: break-all;
    margin-top: 6px;
    user-select: all;
  }
  .muted.small { font-size: 11px; }
  .signin-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
    border-radius: 6px;
    background: #fef0c7;
    color: #b54708;
    font-size: 12px;
    margin-bottom: 8px;
  }
  .signin-banner p { margin: 0; }
  .meta-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
    margin: 8px 0;
  }
  .meta-item { display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
  .meta-label { font-size: 11px; color: #98a2b3; text-transform: uppercase; letter-spacing: 0.04em; }
  .plan-pill {
    display: inline-block;
    padding: 2px 10px;
    border-radius: 12px;
    font-weight: 600;
    font-size: 12px;
    width: fit-content;
  }
  .plan-pill.plan-free { background: #f2f4f7; color: #475467; }
  .plan-pill.plan-pro { background: #d1fadf; color: #027a48; }
  .plan-pill.plan-enterprise { background: #f4ebff; color: #6941c6; }
  .over { color: #b42318; font-weight: 600; }
</style>
