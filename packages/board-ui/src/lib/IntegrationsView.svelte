<script lang="ts">
  import { t } from "./i18n.svelte.js";
  import {
    addJiraSource,
    addGithubSource,
    clearGithubPat,
    cloneGithubRepo,
    deleteSource,
    fetchGithubOauthConfig,
    fetchGithubStatus,
    listGithubRepos,
    listSources,
    pollGithubDeviceFlow,
    setGithubPat,
    startGithubDeviceFlow,
    syncSource,
    testJira,
    type GithubDeviceStart,
    type GithubOauthConfig,
    type GithubRepoSummary,
    type GithubStatus,
    type SourceSummary,
    type SyncResult,
  } from "./api.js";
  import { onDestroy } from "svelte";

  interface Props {
    onClose: () => void;
    onChanged?: () => void;
  }

  let { onClose, onChanged }: Props = $props();

  let tab = $state<"github" | "jira" | "sources">("github");

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

  onDestroy(() => {
    if (ghDeviceTimer) clearInterval(ghDeviceTimer);
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
  loadSources();
</script>

<div class="backdrop" onclick={onClose} role="presentation">
  <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
    <header>
      <div class="title-block">
        <h2>{t("integrations.title")}</h2>
        <div class="tabs">
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
      {#if tab === "github"}
        <section class="panel">
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
              {#if ghOauthConfig?.device_flow_available}
                <button class="primary" onclick={startDeviceFlow}>
                  {t("integrations.github.button.connect_oauth")}
                </button>
              {/if}
              {#if ghOauthConfig}
                <button onclick={() => openInNewTab(ghOauthConfig!.pat_url)}>
                  {t("integrations.github.button.create_token")}
                </button>
              {/if}
              <button class="link" onclick={() => (ghShowTokenForm = !ghShowTokenForm)}>
                {ghShowTokenForm ? "↑" : "↓"} {t("integrations.github.button.connect")}
              </button>
            </div>
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
</style>
