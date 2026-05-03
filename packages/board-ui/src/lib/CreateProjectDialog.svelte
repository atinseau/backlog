<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import DialogShell from "./DialogShell.svelte";
  import { t } from "./i18n.svelte.js";
  import {
    fetchGitRemoteBranches,
    initProject,
    inspectFolder,
    listFolders,
    registerProjectByPath,
    type FolderInspect,
    type FolderList,
    type FolderListEntry,
  } from "./api.js";
  import type { ProjectEntry } from "./types.js";

  function humanizeFolderName(basename: string): string {
    if (!basename) return "";
    const cleaned = basename.replace(/^\./, "");
    const parts = cleaned
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .split(/[-_.\s]+/)
      .map((p) => p.trim())
      .filter(Boolean);
    return parts.map((p) => p[0]!.toUpperCase() + p.slice(1)).join(" ");
  }

  function repoSlugFromGitUrl(url: string): string {
    const trimmed = url.trim().replace(/\/$/, "");
    const last = trimmed.split(/[/:]/).pop() ?? "";
    return last.replace(/\.git$/i, "");
  }

  interface Props {
    onClose: () => void;
    onCreated: (project: ProjectEntry, openRepos: boolean) => void;
    initialPath?: string;
    initialName?: string;
    initialBranch?: string;
  }

  let {
    onClose,
    onCreated,
    initialPath = "",
    initialName = "",
    initialBranch = "main",
  }: Props = $props();

  const initialNameValue = () => initialName;
  const initialPathValue = () => initialPath;
  const initialBranchValue = () => initialBranch || "main";

  let mode = $state<"new" | "git" | "existing">("new");
  let name = $state(initialNameValue());
  let path = $state(initialPathValue());
  let gitUrl = $state("");
  let defaultBranch = $state(initialBranchValue());
  let nameTouched = $state(Boolean(initialNameValue()));
  let branchTouched = $state(Boolean(initialBranchValue() && initialBranchValue() !== "main"));
  let inspection = $state<FolderInspect | null>(null);
  let folderList = $state<FolderList | null>(null);
  let folderBrowserOpen = $state(false);
  let folderLoading = $state(false);
  let folderError = $state<string | null>(null);
  let remoteBranches = $state<string[]>([]);
  let remoteDefaultBranch = $state<string | null>(null);
  let remoteLoading = $state(false);
  let remoteError = $state<string | null>(null);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let inspectTimer: ReturnType<typeof setTimeout> | null = null;
  let remoteTimer: ReturnType<typeof setTimeout> | null = null;
  let remoteLookupSeq = 0;

  const isElectron = typeof window !== "undefined" && Boolean(window.backlog?.pickFolder);
  const branchOptions = $derived(mode === "git" ? remoteBranches : inspection?.branches ?? []);
  const canSubmit = $derived(Boolean(
    path.trim()
      && (mode === "existing" || name.trim())
      && (mode !== "git" || gitUrl.trim()),
  ));

  onMount(() => {
    if (path.trim()) {
      void inspectAndPrefill(path.trim());
    }
    void loadFolders(path.trim() || undefined, { open: false });
  });

  onDestroy(() => {
    if (inspectTimer) clearTimeout(inspectTimer);
    if (remoteTimer) clearTimeout(remoteTimer);
  });

  async function inspectAndPrefill(absolutePath: string) {
    if (!absolutePath) {
      inspection = null;
      return;
    }
    try {
      inspection = await inspectFolder(absolutePath);
    } catch {
      inspection = null;
    }
    if (!inspection) return;
    if (!nameTouched) {
      const guess = humanizeFolderName(inspection.basename);
      if (guess) name = guess;
    }
    if (!branchTouched && inspection.is_git_repo && inspection.current_branch) {
      defaultBranch = inspection.current_branch;
    }
  }

  function schedulePathInspect() {
    if (inspectTimer) clearTimeout(inspectTimer);
    const next = path.trim();
    inspectTimer = setTimeout(() => {
      void inspectAndPrefill(next);
    }, 300);
  }

  async function loadFolders(target?: string, opts: { open?: boolean } = {}) {
    if (opts.open !== false) folderBrowserOpen = true;
    folderLoading = true;
    folderError = null;
    try {
      folderList = await listFolders(target);
    } catch (err) {
      void err;
      folderError = t("create_project.folder.unavailable");
    } finally {
      folderLoading = false;
    }
  }

  async function choosePath() {
    if (isElectron) {
      const picked = await window.backlog!.pickFolder({ title: t("create_project.pick_folder") });
      if (picked) {
        path = picked;
        folderBrowserOpen = false;
        void inspectAndPrefill(picked);
      }
      return;
    }
    await loadFolders(path.trim() || undefined, { open: true });
  }

  async function pickFolder(entry: FolderListEntry) {
    path = entry.path;
    void inspectAndPrefill(entry.path);
    await loadFolders(entry.path, { open: true });
  }

  function useCurrentFolder() {
    if (!folderList) return;
    path = folderList.path;
    folderBrowserOpen = false;
    void inspectAndPrefill(path);
  }

  function prefillFromGitUrl() {
    const slug = repoSlugFromGitUrl(gitUrl);
    if (slug && !nameTouched) name = humanizeFolderName(slug);
  }

  function scheduleRemoteBranchLookup() {
    if (remoteTimer) clearTimeout(remoteTimer);
    const url = gitUrl.trim();
    if (!url) {
      remoteBranches = [];
      remoteDefaultBranch = null;
      remoteError = null;
      remoteLoading = false;
      return;
    }
    remoteTimer = setTimeout(() => {
      void lookupRemoteBranches(url);
    }, 450);
  }

  async function lookupRemoteBranches(url = gitUrl.trim()) {
    if (!url) return;
    const seq = ++remoteLookupSeq;
    remoteLoading = true;
    remoteError = null;
    try {
      const result = await fetchGitRemoteBranches(url);
      if (seq !== remoteLookupSeq) return;
      remoteBranches = result.branches;
      remoteDefaultBranch = result.default_branch;
      const preferred = result.default_branch ?? result.branches[0];
      if (preferred && !branchTouched) defaultBranch = preferred;
    } catch (err) {
      if (seq !== remoteLookupSeq) return;
      remoteBranches = [];
      remoteDefaultBranch = null;
      remoteError = err instanceof Error ? err.message : String(err);
    } finally {
      if (seq === remoteLookupSeq) remoteLoading = false;
    }
  }

  function changeMode(next: "new" | "git" | "existing") {
    mode = next;
    error = null;
    if (next === "git") {
      scheduleRemoteBranchLookup();
    }
  }

  async function submit() {
    if (!canSubmit) return;
    busy = true;
    error = null;
    try {
      const project = mode !== "existing"
        ? await initProject({
            path: path.trim(),
            name: name.trim(),
            git_url: mode === "git" ? gitUrl.trim() : undefined,
            default_branch: defaultBranch.trim() || undefined,
          })
        : await registerProjectByPath(path.trim());
      onCreated(project, mode !== "existing");
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }
</script>

<DialogShell {onClose} ariaLabel={t("create_project.title")} extraClass="create-project-modal">
  <header>
    <div>
      <h2>{t("create_project.title")}</h2>
      <p>{t("create_project.subtitle")}</p>
    </div>
    <button class="close" onclick={onClose} aria-label={t("common.close")}>✕</button>
  </header>

  <div class="content">
    <div class="tabs">
      <button class="tab" class:active={mode === "new"} onclick={() => changeMode("new")}>
        <strong>{t("create_project.tab.new")}</strong>
        <span>{t("create_project.tab.new_hint")}</span>
      </button>
      <button class="tab" class:active={mode === "git"} onclick={() => changeMode("git")}>
        <strong>{t("create_project.tab.git")}</strong>
        <span>{t("create_project.tab.git_hint")}</span>
      </button>
      <button class="tab" class:active={mode === "existing"} onclick={() => changeMode("existing")}>
        <strong>{t("create_project.tab.existing")}</strong>
        <span>{t("create_project.tab.existing_hint")}</span>
      </button>
    </div>

    <section class="panel">
      <div class="panel-copy">
        <h3>{mode === "git" ? t("create_project.section.git") : mode === "existing" ? t("create_project.section.existing") : t("create_project.section.new")}</h3>
        <p>{mode === "git" ? t("create_project.hint.git") : mode === "existing" ? t("create_project.hint.existing") : t("create_project.hint.new")}</p>
      </div>

      {#if mode === "git"}
        <label class="field">
          <span class="label">{t("create_project.field.git_url")}</span>
          <input
            type="text"
            bind:value={gitUrl}
            oninput={() => {
              prefillFromGitUrl();
              scheduleRemoteBranchLookup();
            }}
            placeholder="https://github.com/org/repository.git"
            autocomplete="off"
          />
        </label>
      {/if}

      <div class="field">
        <span class="label">{mode === "git" ? t("create_project.field.clone_path") : t("create_project.field.path")}</span>
        <div class="path-row">
          <input
            type="text"
            bind:value={path}
            oninput={schedulePathInspect}
            onblur={() => void inspectAndPrefill(path.trim())}
            placeholder={mode === "git" ? "/Users/example/Dev/repository" : "/Users/example/Dev/project"}
            autocomplete="off"
          />
          <button class="secondary" type="button" onclick={choosePath}>{t("create_project.button.browse")}</button>
        </div>
        <small>{mode === "git" ? t("create_project.field.clone_path_help") : mode === "existing" ? t("create_project.field.path_existing_help") : t("create_project.field.path_help")}</small>

        {#if inspection}
          <div class="path-summary">
            <span>{inspection.exists ? t("create_project.path.exists") : t("create_project.path.missing")}</span>
            {#if inspection.is_git_repo}<span>{t("create_project.path.git_repo")}</span>{/if}
            {#if inspection.has_backlog_dir}<span>{t("create_project.path.backlog_project")}</span>{/if}
            {#if inspection.current_branch}<span>{t("create_project.path.branch", { branch: inspection.current_branch })}</span>{/if}
          </div>
        {/if}

        {#if folderBrowserOpen && !isElectron}
          <div class="folder-browser">
            <div class="folder-toolbar">
              <button type="button" onclick={() => folderList?.home && loadFolders(folderList.home)} disabled={folderLoading}>{t("create_project.folder.home")}</button>
              <button type="button" onclick={() => folderList?.parent && loadFolders(folderList.parent)} disabled={folderLoading || !folderList?.parent}>{t("create_project.folder.parent")}</button>
              <code>{folderList?.path ?? path}</code>
              <button type="button" class="use-folder" onclick={useCurrentFolder} disabled={!folderList}>{t("create_project.folder.use")}</button>
            </div>
            {#if folderLoading}
              <div class="folder-empty">{t("create_project.folder.loading")}</div>
            {:else if folderError}
              <div class="folder-empty error-text">{folderError}</div>
            {:else if folderList && folderList.entries.length > 0}
              <div class="folder-list">
                {#each folderList.entries as entry (entry.path)}
                  <button type="button" class="folder-row" onclick={() => pickFolder(entry)}>
                    <span class="folder-name">{entry.name}</span>
                    <span class="folder-tags">
                      {#if entry.is_git_repo}<span>{t("create_project.path.git_repo")}</span>{/if}
                      {#if entry.has_backlog_dir}<span>{t("create_project.path.backlog_project")}</span>{/if}
                    </span>
                    <span class="folder-path">{entry.path}</span>
                  </button>
                {/each}
              </div>
            {:else}
              <div class="folder-empty">{t("create_project.folder.empty")}</div>
            {/if}
          </div>
        {/if}
      </div>

      {#if mode !== "existing"}
        <div class="grid">
          <label class="field">
            <span class="label">{t("create_project.field.name")}</span>
            <input
              type="text"
              bind:value={name}
              oninput={() => (nameTouched = true)}
              placeholder="my-project"
              autocomplete="off"
            />
          </label>
          <label class="field">
            <span class="label">{t("create_project.field.default_branch")}</span>
            {#if branchOptions.length > 0}
              <select
                bind:value={defaultBranch}
                onchange={() => (branchTouched = true)}
                disabled={remoteLoading}
              >
                {#each branchOptions as branch (branch)}
                  <option value={branch}>
                    {branch}{branch === inspection?.current_branch || branch === remoteDefaultBranch ? ` · ${t("create_project.branch.default")}` : ""}
                  </option>
                {/each}
              </select>
            {:else}
              <input
                type="text"
                bind:value={defaultBranch}
                oninput={() => (branchTouched = true)}
                placeholder="main"
                autocomplete="off"
              />
            {/if}
            {#if mode === "git"}
              <small>
                {#if remoteLoading}
                  {t("create_project.branch.loading")}
                {:else if remoteError}
                  {t("create_project.branch.manual")}
                {:else if remoteBranches.length > 0}
                  {t("create_project.branch.loaded", { count: String(remoteBranches.length) })}
                {:else}
                  {t("create_project.branch.waiting")}
                {/if}
              </small>
            {/if}
          </label>
        </div>
      {/if}
    </section>

    {#if error}<div class="msg err">{error}</div>{/if}

    <footer>
      <button onclick={onClose}>{t("create_project.button.cancel")}</button>
      <button class="primary" onclick={submit} disabled={busy || !canSubmit}>
        {#if busy}
          {mode === "existing" ? t("create_project.button.adding") : t("create_project.button.creating")}
        {:else}
          {mode === "existing" ? t("create_project.button.add") : t("create_project.button.create")}
        {/if}
      </button>
    </footer>
  </div>
</DialogShell>

<style>
  :global(.create-project-modal) {
    width: min(920px, calc(100vw - 48px));
    max-width: 920px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  header {
    padding: 20px 24px;
    border-bottom: 1px solid var(--border-default);
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
  }
  h2 { margin: 0; font-size: 20px; letter-spacing: 0; }
  header p { margin: 4px 0 0; color: var(--text-secondary); font-size: 13px; }
  .close {
    background: transparent;
    border: none;
    font-size: 18px;
    cursor: pointer;
    color: var(--text-secondary);
    padding: 4px 8px;
  }
  .content {
    padding: 18px 24px 20px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .tabs {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }
  .tab {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-height: 64px;
    background: var(--bg-hover);
    border: 1px solid var(--border-default);
    border-radius: 8px;
    padding: 10px 12px;
    cursor: pointer;
    text-align: left;
    color: var(--text-secondary);
  }
  .tab strong {
    color: var(--text-primary);
    font-size: 13px;
  }
  .tab span {
    font-size: 11px;
    line-height: 1.3;
  }
  .tab.active {
    background: var(--accent-bg);
    border-color: var(--accent);
    color: var(--accent-text);
  }
  .panel {
    border: 1px solid var(--border-default);
    border-radius: 8px;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    background: var(--bg-surface);
  }
  .panel-copy h3 {
    margin: 0 0 3px;
    font-size: 14px;
  }
  .panel-copy p {
    margin: 0;
    color: var(--text-secondary);
    font-size: 12px;
    line-height: 1.45;
  }
  .field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
  .label { font-size: 12px; color: var(--text-secondary); font-weight: 600; }
  input,
  select {
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    padding: 8px 10px;
    font-size: 13px;
    font-family: inherit;
    background: var(--bg-input);
    color: var(--text-primary);
    min-width: 0;
  }
  input:focus,
  select:focus {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  small { color: var(--text-subtle); font-size: 11px; line-height: 1.35; }
  .path-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px;
  }
  .secondary,
  footer button,
  .folder-toolbar button {
    background: var(--bg-hover);
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    color: var(--text-body);
    cursor: pointer;
    font: inherit;
    font-size: 12px;
    padding: 7px 12px;
    white-space: nowrap;
  }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  .path-summary {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .path-summary span,
  .folder-tags span {
    display: inline-flex;
    align-items: center;
    border: 1px solid var(--border-default);
    border-radius: 999px;
    padding: 2px 7px;
    color: var(--text-secondary);
    font-size: 10.5px;
    background: var(--bg-hover);
  }
  .folder-browser {
    border: 1px solid var(--border-default);
    border-radius: 8px;
    overflow: hidden;
    background: var(--bg-canvas);
  }
  .folder-toolbar {
    display: grid;
    grid-template-columns: auto auto minmax(0, 1fr) auto;
    gap: 8px;
    align-items: center;
    padding: 8px;
    border-bottom: 1px solid var(--border-default);
  }
  .folder-toolbar code {
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11px;
  }
  .use-folder {
    color: var(--accent-text);
    border-color: var(--accent);
  }
  .folder-list {
    max-height: 220px;
    overflow: auto;
    display: flex;
    flex-direction: column;
  }
  .folder-row {
    display: grid;
    grid-template-columns: minmax(130px, 0.7fr) auto minmax(0, 1fr);
    gap: 10px;
    align-items: center;
    padding: 8px 10px;
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--border-default);
    color: var(--text-primary);
    cursor: pointer;
    text-align: left;
    font: inherit;
  }
  .folder-row:hover { background: var(--bg-hover); }
  .folder-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
    font-size: 12px;
  }
  .folder-tags {
    display: inline-flex;
    gap: 4px;
    min-width: 0;
  }
  .folder-path {
    color: var(--text-subtle);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .folder-empty {
    padding: 20px;
    color: var(--text-secondary);
    font-size: 12px;
  }
  .error-text { color: var(--warning); }
  .grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(220px, 0.65fr);
    gap: 12px;
  }
  .msg { font-size: 12px; padding: 8px 10px; border-radius: 6px; }
  .msg.err { background: var(--warning-bg); color: var(--warning); }
  footer {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }
  footer .primary {
    background: var(--accent);
    color: var(--accent-on);
    border-color: var(--accent);
  }
  footer .primary:hover:not(:disabled) {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
  }
  @media (max-width: 760px) {
    :global(.create-project-modal) {
      width: min(100vw - 24px, 920px);
    }
    .tabs,
    .grid,
    .folder-toolbar,
    .folder-row,
    .path-row {
      grid-template-columns: 1fr;
    }
    .folder-tags {
      flex-wrap: wrap;
    }
  }
</style>
