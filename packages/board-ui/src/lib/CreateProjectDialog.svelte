<script lang="ts">
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

<div class="backdrop" onclick={onClose} role="presentation">
  <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
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
        <label class="field">
          <span class="label">{t("create_project.field.path")}</span>
          <input
            type="text"
            bind:value={path}
            placeholder="/Users/jimmy/Dev/my-project"
            autocomplete="off"
          />
          <small>{t("create_project.field.path_help")}</small>
        </label>
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
        <label class="field">
          <span class="label">{t("create_project.field.path")}</span>
          <input
            type="text"
            bind:value={path}
            placeholder="/Users/jimmy/Dev/existing-project"
            autocomplete="off"
          />
          <small>{t("create_project.field.path_existing_help")}</small>
        </label>
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
    max-width: 540px;
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
  }
  h2 { margin: 0; font-size: 16px; }
  .close {
    background: transparent;
    border: none;
    font-size: 18px;
    cursor: pointer;
    color: #475467;
  }
  .content { padding: 16px 20px; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; }
  .tabs {
    display: flex;
    gap: 4px;
    background: #f2f4f7;
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
    color: #475467;
    border-radius: 4px;
  }
  .tab.active {
    background: white;
    color: #1d2939;
    box-shadow: 0 1px 2px rgba(16, 24, 40, 0.08);
  }
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
  .muted { color: #98a2b3; }
  .small { font-size: 12px; }
  .row { display: flex; gap: 8px; justify-content: flex-end; margin-top: 4px; }
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
  .msg { font-size: 12px; padding: 6px 10px; border-radius: 4px; }
  .msg.err { background: #fef0c7; color: #b54708; }
</style>
