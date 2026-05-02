<script lang="ts">
  import { t } from "./i18n.svelte.js";
  import { relocateRepoPath } from "./repo-relocate.js";
  import { createRepo, deleteRepo, fetchHooksStatus, fetchRepos, installRepoHook, updateRepo, type HooksOverview, type HookStatus } from "./api.js";
  import type { Repo } from "./types.js";

  // Bridge exposed by packages/desktop's preload.ts is typed once in
  // ./desktop-bridge.d.ts (svelte-check rejects per-component ambient
  // declarations). The board UI is shared between the Electron window
  // and `backlog serve` in a normal browser, hence the runtime guard.
  const isElectron = typeof window !== "undefined" && Boolean(window.backlog);

  function openInFinder(repoPath: string) {
    if (isElectron) {
      window.backlog!.openPath(repoPath).catch(() => undefined);
    } else {
      // Browser-only fallback — copy the path so the user can paste it
      // into Finder / Explorer themselves.
      navigator.clipboard?.writeText(repoPath).catch(() => undefined);
    }
  }

  interface Props {
    onClose: () => void;
    onChanged?: () => void;
    embedded?: boolean;
    initialShowCreate?: boolean;
  }

  let { onClose, onChanged, embedded = false, initialShowCreate = false }: Props = $props();

  let repos = $state<Repo[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let hooks = $state<HooksOverview | null>(null);
  let hooksLoading = $state(false);
  let installingHookFor = $state<string | null>(null);

  function hookStatusOf(repoId: string): HookStatus | undefined {
    return hooks?.hooks.find((h) => h.repo_id === repoId);
  }
  function hookStatusLabel(status: HookStatus | undefined): { label: string; tone: "ok" | "warn" | "off" | "missing" } {
    if (!status) return { label: t("hooks.status.unknown"), tone: "off" };
    if (!status.git_dir) return { label: t("hooks.status.no_git"), tone: "missing" };
    if (!status.exists) return { label: t("hooks.status.not_installed"), tone: "off" };
    if (status.managed && status.points_to_backlog_bin && status.up_to_date) return { label: t("hooks.status.current"), tone: "ok" };
    if (status.managed && status.points_to_backlog_bin) return { label: t("hooks.status.outdated"), tone: "warn" };
    if (status.exists && !status.managed) return { label: t("hooks.status.foreign"), tone: "warn" };
    return { label: t("hooks.status.outdated"), tone: "warn" };
  }

  const outdatedManagedHooks = $derived(hooks?.hooks.filter((status) =>
    status.exists && status.managed && status.points_to_backlog_bin && !status.up_to_date,
  ) ?? []);

  async function loadHooks() {
    hooksLoading = true;
    try {
      hooks = await fetchHooksStatus();
    } catch {
      // best effort — leave previous state
    } finally {
      hooksLoading = false;
    }
  }

  async function updateHook(repoId: string) {
    installingHookFor = repoId;
    try {
      await installRepoHook(repoId);
      await loadHooks();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      installingHookFor = null;
    }
  }

  // svelte-ignore state_referenced_locally
  let showCreate = $state(initialShowCreate);
  let createMode = $state<"local" | "clone" | "remote-github">("local");
  let newId = $state("");
  let newPath = $state("");
  let newGitUrl = $state("");
  let newCloneInto = $state("");
  let newBranch = $state("main");
  let newRole = $state("");
  // Default to read-write because that's what most users want when
  // adding a repository they own. Switch to read-only for vendored
  // dependencies / context-only repos that the agent should be able
  // to inspect but not edit.
  let newAccessMode = $state<"read-write" | "read-only" | "no-access">("read-write");
  let creating = $state(false);

  async function load() {
    loading = true;
    try {
      repos = await fetchRepos();
      error = null;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
    void loadHooks();
  }

  async function handleCreate(event: SubmitEvent) {
    event.preventDefault();
    if (createMode === "remote-github") {
      error = t("repos_view.remote.not_available");
      return;
    }
    creating = true;
    try {
      const input: Parameters<typeof createRepo>[0] = {};
      if (newId.trim()) input.id = newId.trim();
      if (newRole.trim()) input.role = newRole.trim();
      if (newBranch.trim()) input.default_branch = newBranch.trim();
      input.access_mode = newAccessMode;

      if (createMode === "clone") {
        if (!newGitUrl.trim()) throw new Error("URL Git requise");
        input.git_url = newGitUrl.trim();
        if (newCloneInto.trim()) input.clone_into = newCloneInto.trim();
      } else {
        if (!newPath.trim()) throw new Error("Chemin local requis");
        if (!newId.trim()) throw new Error("Id requis");
        if (!newBranch.trim()) throw new Error("Branche par défaut requise");
        input.path = newPath.trim();
      }

      await createRepo(input);
      newId = "";
      newPath = "";
      newGitUrl = "";
      newCloneInto = "";
      newBranch = "main";
      newRole = "";
      newAccessMode = "read-write";
      showCreate = false;
      await load();
      onChanged?.();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      creating = false;
    }
  }

  async function handleToggleEnabled(repo: Repo) {
    try {
      await updateRepo(repo.id, { enabled: !repo.enabled });
      await load();
      onChanged?.();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  async function handleAccessModeChange(repo: Repo, mode: "read-write" | "read-only" | "no-access") {
    if (mode === (repo.access_mode ?? "read-write")) return;
    try {
      await updateRepo(repo.id, { access_mode: mode });
      await load();
      onChanged?.();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  async function handleDelete(repo: Repo) {
    const force = confirm(
      `Supprimer le repo "${repo.id}" ?\n\nOK = supprimer (avec --force pour cascader sur tâches/sous-tâches/agents)\nAnnuler = abandonner.`,
    );
    if (!force) return;
    try {
      await deleteRepo(repo.id, { force: true });
      await load();
      onChanged?.();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  async function handleRename(repo: Repo) {
    const next = prompt(`Renommer le repo ${repo.id} →`, repo.id);
    if (!next || next === repo.id) return;
    try {
      await updateRepo(repo.id, { id: next });
      await load();
      onChanged?.();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  async function handleRelocate(repo: Repo) {
    try {
      const relocated = await relocateRepoPath(repo.id, repo.path);
      if (!relocated) return;
      await load();
      onChanged?.();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  function providerLabel(provider: Repo["provider"]): string {
    if (provider === "github") return "GitHub";
    if (provider === "gitlab") return "GitLab";
    if (provider === "bitbucket") return "Bitbucket";
    if (provider === "other") return "Git";
    return "Local";
  }

  load();
</script>

{#snippet body()}
    <header>
      <h2>{t("repos_view.title")}</h2>
      {#if !embedded}
        <button class="close" onclick={onClose}>✕</button>
      {/if}
    </header>

    {#if error}
      <div class="error">{error}</div>
    {/if}

    {#if loading}
      <div class="loading">chargement…</div>
    {:else}
      <section class="hooks-block">
        <header class="hooks-head">
          <h3>{t("hooks.title")}</h3>
          <button class="ghost small" onclick={loadHooks} disabled={hooksLoading} title={t("hooks.refresh")}>
            {hooksLoading ? "…" : "↻"}
          </button>
        </header>
        <p class="hooks-hint">{t("hooks.hint")}</p>
        {#if hooks?.project_paused_until}
          <div class="hook-pause">⏸ {t("hooks.paused_until", { until: hooks.project_paused_until })}</div>
        {/if}
        {#if outdatedManagedHooks.length > 0}
          <div class="hook-update-warning">
            <span>{t("hooks.update_available", { count: outdatedManagedHooks.length })}</span>
          </div>
        {/if}
        <div class="hooks-cli">
          <div><code>backlog hooks install</code> — {t("hooks.cli.install")}</div>
          <div><code>backlog hooks status</code> — {t("hooks.cli.status")}</div>
          <div><code>backlog hooks pause 30m</code> — {t("hooks.cli.pause")}</div>
          <div><code>backlog hooks uninstall</code> — {t("hooks.cli.uninstall")}</div>
        </div>
      </section>

      <ul class="repos">
        {#each repos as repo (repo.id)}
          {@const hookStatus = hookStatusOf(repo.id)}
          {@const hookLabel = hookStatusLabel(hookStatus)}
          {@const accessMode = repo.access_mode ?? "read-write"}
          <li class:disabled={!repo.enabled}>
            <div class="info">
              <div class="title-row">
                <strong>{repo.id}</strong>
                {#if repo.provider && repo.provider !== "local"}
                  <span class="provider-badge provider-{repo.provider}">{providerLabel(repo.provider)}</span>
                {/if}
                {#if repo.role}<span class="role">{repo.role}</span>{/if}
                <span class="access-pill access-{accessMode}" title={t(`repos_view.access_hint_${accessMode.replace("-", "_")}`)}>
                  {t(`repos_view.access_${accessMode.replace("-", "_")}`)}
                </span>
                {#if !repo.enabled}<span class="off">disabled</span>{/if}
                <span class="hook-badge hook-{hookLabel.tone}" title={hookStatus?.hook_path ?? ""}>
                  hook : {hookLabel.label}
                </span>
                {#if hookStatus?.exists && hookStatus.managed && hookStatus.points_to_backlog_bin && !hookStatus.up_to_date}
                  <button
                    class="hook-update"
                    onclick={() => updateHook(repo.id)}
                    disabled={installingHookFor === repo.id}
                    title={t("hooks.update_button")}
                  >
                    {installingHookFor === repo.id ? "…" : t("hooks.update_button")}
                  </button>
                {/if}
              </div>
              <button
                class="path-link"
                onclick={(e) => { e.stopPropagation(); openInFinder(repo.path); }}
                title={isElectron ? t("repos_view.open_folder") : t("repos_view.copy_path")}
              >
                <span class="path-icon">📂</span>
                <span class="path-text">{repo.path}</span>
              </button>
              <span class="branch">branche par défaut : {repo.default_branch}</span>
              {#if repo.git_url}
                <span class="git-url">{repo.git_url}</span>
              {/if}
            </div>
            <div class="actions">
              <select
                value={accessMode}
                onchange={(e) => handleAccessModeChange(repo, (e.currentTarget as HTMLSelectElement).value as "read-write" | "read-only" | "no-access")}
                title={t("repos_view.access_change_title")}
              >
                <option value="read-write">{t("repos_view.access_read_write")}</option>
                <option value="read-only">{t("repos_view.access_read_only")}</option>
                <option value="no-access">{t("repos_view.access_no_access")}</option>
              </select>
              <button onclick={() => handleRename(repo)} title="Renommer">✎</button>
              <button onclick={() => handleRelocate(repo)}>
                {t("repos_view.relocate")}
              </button>
              <button onclick={() => handleToggleEnabled(repo)}>
                {repo.enabled ? "désactiver" : "activer"}
              </button>
              <button class="danger" onclick={() => handleDelete(repo)}>supprimer</button>
            </div>
          </li>
        {/each}
        {#if repos.length === 0}
          <li class="empty">aucun repository configuré</li>
        {/if}
      </ul>

      {#if showCreate}
        <form class="create" onsubmit={handleCreate}>
          <div class="tabs">
            <button
              type="button"
              class="tab"
              class:active={createMode === "local"}
              onclick={() => (createMode = "local")}
            >
              📁 Local
            </button>
            <button
              type="button"
              class="tab"
              class:active={createMode === "clone"}
              onclick={() => (createMode = "clone")}
            >
              ⬇ Cloner Git
            </button>
            <button
              type="button"
              class="tab"
              class:active={createMode === "remote-github"}
              onclick={() => (createMode = "remote-github")}
            >
              {t("repos_view.add.remote_github")}
            </button>
          </div>

          {#if createMode === "remote-github"}
            <section class="remote-panel">
              <div>
                <h3>{t("repos_view.remote.title")}</h3>
                <p>{t("repos_view.remote.body")}</p>
              </div>
              <div class="remote-state">
                <span class="remote-dot"></span>
                <span>{t("repos_view.remote.cloud_required")}</span>
              </div>
              <p class="remote-note">{t("repos_view.remote.clone_fallback")}</p>
            </section>
          {:else if createMode === "clone"}
            <label class="full">
              URL Git
              <input
                bind:value={newGitUrl}
                placeholder="https://github.com/user/repo.git"
                required
              />
            </label>
            <div class="row">
              <label>Id <span class="hint">(auto si vide)</span><input bind:value={newId} placeholder="repo" pattern="[a-zA-Z0-9_-]*" /></label>
              <label>Branche<input bind:value={newBranch} placeholder="main" /></label>
            </div>
            <label class="full">
              Cloner dans <span class="hint">(défaut : project/repos/&lt;id&gt;)</span>
              <input bind:value={newCloneInto} placeholder="repos/frontend" />
            </label>
          {:else}
            <div class="row">
              <label>Id<input bind:value={newId} placeholder="frontend" required pattern="[a-zA-Z0-9_-]+" /></label>
              <label>Branche par défaut<input bind:value={newBranch} placeholder="main" /></label>
            </div>
            <div class="full">
              <span class="hint-label">Dossier du repository</span>
              {#if isElectron}
                <button class="picker" type="button" onclick={async () => {
                  const picked = await window.backlog!.pickFolder({ title: "Choisir le repository" });
                  if (picked) newPath = picked;
                }}>
                  <span class="picker-icon">📂</span>
                  <span class="picker-value">{newPath || "Choisir un dossier…"}</span>
                </button>
              {:else}
                <input bind:value={newPath} placeholder="/Users/jimmy/Dev/twoody/twoody-frontend" required />
              {/if}
            </div>
          {/if}

          {#if createMode !== "remote-github"}
            <div class="row">
              <label>
                {t("repos_view.access_mode")}
                <select bind:value={newAccessMode}>
                  <option value="read-write">{t("repos_view.access_read_write")}</option>
                  <option value="read-only">{t("repos_view.access_read_only")}</option>
                  <option value="no-access">{t("repos_view.access_no_access")}</option>
                </select>
                <span class="hint">{t(`repos_view.access_hint_${newAccessMode.replace("-", "_")}`)}</span>
              </label>
              <label>Rôle (optionnel)<input bind:value={newRole} placeholder="api / web / firmware" /></label>
            </div>
          {/if}
          <div class="form-actions">
            <button type="button" onclick={() => (showCreate = false)}>annuler</button>
            <button class="primary" type="submit" disabled={creating || createMode === "remote-github"}>
              {createMode === "remote-github" ? t("repos_view.remote.button_disabled") : creating ? (createMode === "clone" ? "clonage…" : "ajout…") : (createMode === "clone" ? "cloner" : "ajouter")}
            </button>
          </div>
        </form>
      {:else}
        <button class="add" onclick={() => (showCreate = true)}>+ ajouter un repository</button>
      {/if}
    {/if}
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
  .embedded {
    background: var(--bg-app);
    color: var(--text-primary);
    height: 100%;
    width: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .modal {
    background: var(--bg-surface);
    color: var(--text-primary);
    border-radius: 8px;
    box-shadow: var(--shadow-modal);
    max-width: 580px;
    width: 92%;
    max-height: 80vh;
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
  }
  h2 { margin: 0; font-size: 16px; }
  .close { background: transparent; border: none; font-size: 18px; cursor: pointer; color: var(--text-secondary); }
  .error { background: var(--warning-bg); color: var(--warning); padding: 8px 20px; font-size: 12px; }
  .loading {
    padding: 32px;
    text-align: center;
    color: var(--text-muted);
  }
  .hooks-block {
    margin: 12px 16px 4px;
    padding: 12px 14px;
    border: 1px solid var(--border-default);
    border-radius: 6px;
    background: var(--bg-elevated);
    color: var(--text-body);
    flex-shrink: 0;
  }
  .hooks-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    border: none;
    padding: 0;
    margin-bottom: 4px;
  }
  .hooks-head h3 {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .hooks-hint {
    margin: 0 0 8px;
    font-size: 12px;
    color: var(--text-muted);
    line-height: 1.4;
  }
  .hook-pause {
    margin-bottom: 8px;
    padding: 4px 8px;
    border-radius: 4px;
    background: var(--warning-bg);
    color: var(--warning);
    font-size: 12px;
  }
  .hook-update-warning {
    margin-bottom: 8px;
    padding: 6px 8px;
    border-radius: 4px;
    background: var(--warning-bg);
    color: var(--warning);
    font-size: 12px;
    line-height: 1.35;
  }
  .hooks-cli {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    color: var(--text-muted);
  }
  .hooks-cli code {
    background: var(--bg-input);
    border: 1px solid var(--border-default);
    color: var(--text-body);
    padding: 1px 6px;
    border-radius: 3px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px;
  }
  .hook-badge {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 3px;
    font-weight: 500;
    letter-spacing: 0.02em;
  }
  .hook-ok      { background: var(--success-bg); color: var(--success); }
  .hook-warn    { background: var(--warning-bg); color: var(--warning); }
  .hook-off     { background: var(--bg-hover); color: var(--text-muted); }
  .hook-missing { background: var(--danger-bg); color: var(--danger); }
  .hook-update {
    border: 1px solid var(--border-default);
    background: var(--bg-hover);
    color: var(--text-body);
    border-radius: 4px;
    font-size: 11px;
    padding: 2px 7px;
    cursor: pointer;
  }
  .hook-update:hover:not(:disabled) {
    border-color: var(--warning);
    color: var(--warning);
  }
  .hook-update:disabled {
    opacity: 0.6;
    cursor: wait;
  }
  .hint-label { display: block; font-size: 12px; color: var(--text-muted); margin-bottom: 4px; }
  .picker {
    display: flex; align-items: center; gap: 8px;
    width: 100%;
    padding: 8px 10px;
    border: 1px dashed var(--border-strong);
    border-radius: 4px;
    background: var(--bg-input);
    cursor: pointer; text-align: left;
    color: var(--text-secondary);
    font: inherit; font-size: 13px;
  }
  .picker:hover {
    border-style: solid; border-color: var(--accent);
    color: var(--text-primary);
  }
  .picker-icon { flex-shrink: 0; }
  .picker-value {
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    flex: 1; min-width: 0;
    font-family: ui-monospace, monospace; font-size: 11.5px;
  }
  button.ghost {
    background: transparent;
    border: 1px solid var(--border-strong);
    color: var(--text-secondary);
    border-radius: 4px;
    cursor: pointer;
  }
  button.ghost:hover { background: var(--bg-hover); color: var(--text-primary); }
  button.ghost.small {
    padding: 2px 8px;
    font-size: 12px;
  }

  .repos {
    list-style: none;
    margin: 0;
    padding: 8px 0;
    overflow-y: auto;
    flex: 1;
  }
  .repos li {
    display: flex;
    gap: 12px;
    padding: 10px 20px;
    border-bottom: 1px solid var(--border-subtle);
    align-items: flex-start;
  }
  .repos li.disabled { opacity: 0.5; }
  .repos li.empty {
    padding: 24px 20px;
    text-align: center;
    color: var(--text-subtle);
    border: none;
  }
  .info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .title-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
  }
  .role {
    font-size: 11px;
    background: var(--accent-bg);
    color: var(--accent-text);
    padding: 1px 6px;
    border-radius: 3px;
  }
  .provider-badge {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 3px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-weight: 700;
  }
  .provider-github {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
  .provider-gitlab,
  .provider-bitbucket,
  .provider-other {
    background: var(--accent-bg);
    color: var(--accent-text);
  }
  .off {
    font-size: 11px;
    background: var(--danger-bg);
    color: var(--danger);
    padding: 1px 6px;
    border-radius: 3px;
  }
  .access-pill {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 3px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-weight: 600;
  }
  .access-read-write {
    background: var(--success-bg);
    color: var(--success);
  }
  .access-read-only {
    background: var(--warning-bg);
    color: var(--warning);
  }
  .access-no-access {
    background: var(--bg-hover);
    color: var(--text-muted);
  }
  .path {
    font-family: ui-monospace, monospace;
    font-size: 11px;
    color: var(--text-secondary);
    word-break: break-all;
  }
  .path-link {
    background: transparent;
    border: none;
    padding: 0;
    cursor: pointer;
    font-family: ui-monospace, monospace;
    font-size: 11px;
    color: var(--text-secondary);
    text-align: left;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    word-break: break-all;
  }
  .path-link:hover {
    color: var(--accent);
  }
  .path-link:hover .path-text {
    text-decoration: underline;
  }
  .path-icon {
    flex-shrink: 0;
    font-size: 12px;
  }
  .branch {
    font-size: 11px;
    color: var(--text-muted);
  }
  .git-url {
    font-family: ui-monospace, monospace;
    font-size: 11px;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
  }
  .actions {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
  }
  button {
    background: var(--bg-hover);
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    padding: 4px 8px;
    cursor: pointer;
    font-size: 12px;
  }
  button.danger { color: var(--danger); }
  button.add {
    margin: 12px 20px;
    align-self: flex-start;
  }
  .create {
    padding: 16px 20px;
    background: var(--bg-muted);
    border-top: 1px solid var(--border-default);
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .tabs {
    display: flex;
    gap: 4px;
    margin-bottom: 4px;
  }
  .tab {
    flex: 1;
    background: var(--bg-surface);
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    padding: 6px 10px;
    cursor: pointer;
    font-size: 13px;
    color: var(--text-secondary);
  }
  .tab.active {
    background: var(--accent);
    color: white;
    border-color: var(--accent);
  }
  .remote-panel {
    border: 1px solid var(--border-default);
    border-radius: 6px;
    background: var(--bg-elevated);
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .remote-panel h3 {
    margin: 0 0 4px;
    font-size: 13px;
    color: var(--text-primary);
  }
  .remote-panel p {
    margin: 0;
    font-size: 12px;
    line-height: 1.45;
    color: var(--text-muted);
  }
  .remote-state {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    align-self: flex-start;
    padding: 5px 8px;
    border-radius: 4px;
    background: var(--warning-bg);
    color: var(--warning);
    font-size: 12px;
    font-weight: 600;
  }
  .remote-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: currentColor;
  }
  .remote-note {
    border-top: 1px solid var(--border-subtle);
    padding-top: 10px;
  }
  .hint {
    color: var(--text-subtle);
    font-weight: 400;
  }
  .row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .create label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 11px;
    color: var(--text-secondary);
  }
  .create label.full { grid-column: 1 / -1; }
  .create input {
    padding: 6px 8px;
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    font-size: 13px;
  }
  .form-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  button.primary {
    background: var(--accent);
    color: white;
    border-color: var(--accent);
  }
  button.primary:hover { background: var(--accent-hover); }
</style>
