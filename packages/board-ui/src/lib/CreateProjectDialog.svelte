<script lang="ts">
  import DialogShell from "./DialogShell.svelte";
  import { t } from "./i18n.svelte.js";
  import { initProject, registerProjectByPath } from "./api.js";
  import type { ProjectEntry } from "./types.js";

  interface Props {
    onClose: () => void;
    onCreated: (project: ProjectEntry, openRepos: boolean) => void;
  }

  let { onClose, onCreated }: Props = $props();

  let mode = $state<"new" | "existing">("new");
  let name = $state("");
  let path = $state("");
  let defaultBranch = $state("main");
  let busy = $state(false);
  let error = $state<string | null>(null);

  // Optional bridge exposed by the Electron preload. When running in a
  // pure browser (backlog serve), it's undefined and we fall back to a
  // text input.
  interface BacklogBridge {
    pickFolder(opts?: { title?: string }): Promise<string | null>;
  }
  declare global { interface Window { backlog?: BacklogBridge } }
  const isElectron = typeof window !== "undefined" && Boolean(window.backlog?.pickFolder);

  async function pickPath() {
    if (!isElectron) return;
    const picked = await window.backlog!.pickFolder({ title: t("create_project.pick_folder") });
    if (picked) path = picked;
  }

  async function submit() {
    if (!path.trim()) return;
    if (mode === "new" && !name.trim()) return;
    busy = true;
    error = null;
    try {
      const project = mode === "new"
        ? await initProject({
            path: path.trim(),
            name: name.trim(),
            default_branch: defaultBranch.trim() || undefined,
          })
        : await registerProjectByPath(path.trim());
      onCreated(project, mode === "new");
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }
</script>

<DialogShell {onClose} ariaLabel={t("create_project.title")} extraClass="create-project-modal">
  <header>
    <h2>{t("create_project.title")}</h2>
    <button class="close" onclick={onClose}>✕</button>
  </header>

  <div class="content">
    <div class="tabs">
      <button class="tab" class:active={mode === "new"} onclick={() => (mode = "new")}>
        {t("create_project.tab.new")}
      </button>
      <button class="tab" class:active={mode === "existing"} onclick={() => (mode = "existing")}>
        {t("create_project.tab.existing")}
      </button>
    </div>

    {#if mode === "new"}
      <p class="muted small">{t("create_project.hint.new")}</p>
      <div class="field">
        <span class="label">{t("create_project.field.path")}</span>
        {#if isElectron}
          <button class="picker" onclick={pickPath} type="button">
            <span class="picker-icon">📂</span>
            <span class="picker-value">{path || t("create_project.choose_folder")}</span>
          </button>
        {:else}
          <input type="text" bind:value={path} placeholder="/Users/jimmy/Dev/my-project" autocomplete="off" />
        {/if}
        <small>{t("create_project.field.path_help")}</small>
      </div>
      <label class="field">
        <span class="label">{t("create_project.field.name")}</span>
        <input type="text" bind:value={name} placeholder="my-project" autocomplete="off" />
      </label>
      <label class="field">
        <span class="label">{t("create_project.field.default_branch")}</span>
        <input type="text" bind:value={defaultBranch} placeholder="main" autocomplete="off" />
      </label>
    {:else}
      <p class="muted small">{t("create_project.hint.existing")}</p>
      <div class="field">
        <span class="label">{t("create_project.field.path")}</span>
        {#if isElectron}
          <button class="picker" onclick={pickPath} type="button">
            <span class="picker-icon">📂</span>
            <span class="picker-value">{path || t("create_project.choose_folder")}</span>
          </button>
        {:else}
          <input type="text" bind:value={path} placeholder="/Users/jimmy/Dev/existing-project" autocomplete="off" />
        {/if}
        <small>{t("create_project.field.path_existing_help")}</small>
      </div>
    {/if}

    {#if error}<div class="msg err">{error}</div>{/if}

    <div class="row">
      <button onclick={onClose}>{t("create_project.button.cancel")}</button>
      <button
        class="primary"
        onclick={submit}
        disabled={busy || !path.trim() || (mode === "new" && !name.trim())}
      >
        {#if busy}
          {mode === "new" ? t("create_project.button.creating") : t("create_project.button.adding")}
        {:else}
          {mode === "new" ? t("create_project.button.create") : t("create_project.button.add")}
        {/if}
      </button>
    </div>
  </div>
</DialogShell>

<style>
  /* Frame (.modal, .backdrop) lives in DialogShell. Per-dialog
     sizing override goes through the extraClass + :global() pair. */
  :global(.create-project-modal) {
    max-width: 540px;
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
  .close {
    background: transparent;
    border: none;
    font-size: 18px;
    cursor: pointer;
    color: var(--text-secondary);
  }
  .content { padding: 16px 20px; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; }
  .tabs {
    display: flex;
    gap: 4px;
    background: var(--bg-hover);
    border-radius: 6px;
    padding: 2px;
    align-self: flex-start;
  }
  .tab {
    background: transparent;
    border: none;
    padding: 4px 12px;
    cursor: pointer;
    font-size: 12px;
    color: var(--text-secondary);
    border-radius: 4px;
  }
  .tab.active {
    background: var(--bg-surface);
    color: var(--text-primary);
    box-shadow: 0 1px 2px rgba(16, 24, 40, 0.08);
  }
  .field { display: flex; flex-direction: column; gap: 4px; }
  .label { font-size: 12px; color: var(--text-secondary); font-weight: 500; }
  input {
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    padding: 6px 10px;
    font-size: 13px;
    font-family: inherit;
  }
  small { color: var(--text-subtle); font-size: 11px; }
  .picker {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border: 1px dashed var(--border-strong);
    border-radius: 4px;
    background: var(--bg-input);
    cursor: pointer;
    text-align: left;
    color: var(--text-secondary);
    font: inherit;
    font-size: 13px;
  }
  .picker:hover {
    border-style: solid;
    border-color: var(--accent);
    color: var(--text-primary);
  }
  .picker-icon { flex-shrink: 0; }
  .picker-value {
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    flex: 1; min-width: 0;
    font-family: ui-monospace, monospace;
    font-size: 11.5px;
  }
  .muted { color: var(--text-subtle); }
  .small { font-size: 12px; }
  .row { display: flex; gap: 8px; justify-content: flex-end; margin-top: 4px; }
  button {
    background: var(--bg-hover);
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    padding: 4px 12px;
    cursor: pointer;
    font-size: 13px;
  }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  button.primary { background: var(--accent); color: white; border-color: var(--accent); }
  button.primary:hover:not(:disabled) { background: var(--accent-hover); }
  .msg { font-size: 12px; padding: 6px 10px; border-radius: 4px; }
  .msg.err { background: var(--warning-bg); color: var(--warning); }
</style>
