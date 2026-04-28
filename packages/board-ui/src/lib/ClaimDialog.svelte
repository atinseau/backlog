<script lang="ts">
  import { createClaim, type ClaimConflict } from "./api.js";
  import { t } from "./i18n.svelte.js";

  interface Props {
    repos: string[];
    onClose: () => void;
    onCreated: () => void;
  }

  let { repos, onClose, onCreated }: Props = $props();

  // Initial-from-prop: seed the repo dropdown with the first available;
  // user picks afterwards persist independently of subsequent prop
  // changes (which would reset their selection if reactive).
  // svelte-ignore state_referenced_locally
  let repo = $state(repos[0] ?? "");
  let topic = $state("");
  let pathsRaw = $state("");
  let durationMinutes = $state("30");
  let agentId = $state("");
  let submitting = $state(false);
  let conflict = $state<ClaimConflict | null>(null);
  let genericError = $state<string | null>(null);

  function parsePaths(): string[] {
    return pathsRaw
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  function reasonForDuration(): number | undefined {
    const n = Number.parseInt(durationMinutes, 10);
    if (Number.isNaN(n) || n <= 0) return undefined;
    return n * 60;
  }

  async function handleSubmit(event: Event) {
    event.preventDefault();
    conflict = null;
    genericError = null;

    const paths = parsePaths();
    if (!repo || !topic || paths.length === 0) {
      genericError = "repo, topic and at least one path are required";
      return;
    }

    submitting = true;
    try {
      const seconds = reasonForDuration();
      const result = await createClaim({
        repo,
        topic,
        paths,
        ttl_minutes: Math.max(1, Math.ceil((seconds ?? 1800) / 60)),
        ...(seconds !== undefined ? { expected_duration_seconds: seconds } : {}),
        ...(agentId ? { agent_id: agentId } : {}),
      });
      if (result.ok) {
        onCreated();
        onClose();
      } else {
        conflict = result.conflict;
      }
    } catch (err) {
      genericError = err instanceof Error ? err.message : String(err);
    } finally {
      submitting = false;
    }
  }
</script>

<div class="backdrop" onclick={onClose} role="presentation">
  <div class="dialog" role="dialog" aria-modal="true" aria-label={t("claim_dialog.title")} onclick={(e) => e.stopPropagation()} tabindex={-1} onkeydown={(e) => { if (e.key === "Escape") onClose(); }}>
    <header>
      <h2>{t("claim_dialog.title")}</h2>
      <button class="close" onclick={onClose} aria-label={t("claim_dialog.close")}>×</button>
    </header>

    <form onsubmit={handleSubmit}>
      <label>
        {t("claim_dialog.field.repo")}
        {#if repos.length === 0}
          <input type="text" bind:value={repo} placeholder="repo id" required />
        {:else}
          <select bind:value={repo} required>
            {#each repos as r (r)}
              <option value={r}>{r}</option>
            {/each}
          </select>
        {/if}
      </label>

      <label>
        {t("claim_dialog.field.topic")}
        <input type="text" bind:value={topic} placeholder={t("claim_dialog.field.topic.placeholder")} required />
      </label>

      <label>
        {t("claim_dialog.field.paths")}
        <textarea
          bind:value={pathsRaw}
          rows="3"
          placeholder={"src/auth/**\nsrc/utils/login.ts"}
          required
        ></textarea>
      </label>

      <div class="row">
        <label>
          {t("claim_dialog.field.duration")}
          <input type="number" min="1" bind:value={durationMinutes} />
        </label>
        <label>
          {t("claim_dialog.field.agent")}
          <input type="text" bind:value={agentId} placeholder="claude-default" />
        </label>
      </div>

      {#if conflict}
        <div class="conflict">
          <strong>{t("claim_dialog.conflict.title")}</strong>
          <p>{t("claim_dialog.conflict.body", { id: conflict.conflict_with, topic: conflict.blocking_topic, paths: conflict.blocking_paths.join(", ") })}</p>
          <p>
            <strong>{t("claim_dialog.conflict.retry", { min: Math.ceil(conflict.retry_after_seconds / 60) })}</strong>
            {#if conflict.blocking_status === "overdue"}
              <span class="overdue">{t("claim_dialog.conflict.overdue")}</span>
            {/if}
            <span class="src">[{conflict.retry_after_source}]</span>
          </p>
        </div>
      {/if}

      {#if genericError}
        <div class="error">{genericError}</div>
      {/if}

      <footer>
        <button type="button" onclick={onClose}>{t("claim_dialog.button.cancel")}</button>
        <button type="submit" class="primary" disabled={submitting}>
          {submitting ? t("claim_dialog.button.creating") : t("claim_dialog.button.create")}
        </button>
      </footer>
    </form>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 50;
  }
  .dialog {
    background: white;
    border-radius: 8px;
    width: min(480px, 90vw);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.2);
    padding: 0;
  }
  .dialog header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 14px 16px;
    border-bottom: 1px solid #e4e7ec;
  }
  .dialog h2 { margin: 0; font-size: 16px; }
  .close {
    background: none;
    border: none;
    font-size: 22px;
    cursor: pointer;
    color: #667085;
  }
  form {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    color: #344054;
  }
  input, select, textarea {
    font: inherit;
    padding: 6px 8px;
    border: 1px solid #d0d5dd;
    border-radius: 4px;
    width: 100%;
  }
  textarea {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    resize: vertical;
  }
  .row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .conflict {
    background: #fef0c7;
    color: #7a2e0e;
    padding: 8px 10px;
    border-radius: 4px;
    font-size: 12px;
  }
  .conflict p { margin: 4px 0; }
  .conflict .overdue { color: #b42318; font-weight: 600; }
  .conflict .src { color: #667085; font-size: 11px; }
  .error {
    background: #fee4e2;
    color: #b42318;
    padding: 8px 10px;
    border-radius: 4px;
    font-size: 12px;
  }
  footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding-top: 4px;
  }
  button {
    background: #f2f4f7;
    border: 1px solid #d0d5dd;
    border-radius: 4px;
    padding: 6px 14px;
    cursor: pointer;
  }
  button.primary {
    background: #1570ef;
    color: white;
    border-color: #1570ef;
  }
  button.primary:disabled {
    background: #98a2b3;
    border-color: #98a2b3;
    cursor: wait;
  }
</style>
