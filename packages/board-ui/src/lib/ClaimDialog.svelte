<script lang="ts">
  import { createClaim, type ClaimConflict } from "./api.js";
  import { focusTrap } from "./DialogShell.svelte";
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
      genericError = t("claim_dialog.error.required");
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
  <div use:focusTrap class="dialog" role="dialog" aria-modal="true" aria-label={t("claim_dialog.title")} onclick={(e) => e.stopPropagation()} tabindex={-1} onkeydown={(e) => { if (e.key === "Escape") onClose(); }}>
    <header>
      <h2>{t("claim_dialog.title")}</h2>
      <button class="close" onclick={onClose} aria-label={t("claim_dialog.close")}>×</button>
    </header>

    <form onsubmit={handleSubmit}>
      <label>
        {t("claim_dialog.field.repo")}
        {#if repos.length === 0}
          <input type="text" bind:value={repo} placeholder={t("claim_dialog.field.repo.placeholder")} required />
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
    background: var(--backdrop);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 50;
  }
  .dialog {
    background: var(--bg-surface);
    border-radius: 8px;
    width: min(480px, 90vw);
    box-shadow: var(--shadow-modal);
    padding: 0;
  }
  .dialog header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 14px 16px;
    border-bottom: 1px solid var(--border-default);
  }
  .dialog h2 { margin: 0; font-size: 16px; }
  .close {
    background: none;
    border: none;
    font-size: 18px;
    cursor: pointer;
    color: var(--text-muted);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: var(--tap-size);
    min-height: var(--tap-size);
    border-radius: 4px;
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
    color: var(--text-body);
  }
  input, select, textarea {
    font: inherit;
    padding: 6px 8px;
    border: 1px solid var(--border-field);
    border-radius: 4px;
    width: 100%;
  }
  input::placeholder,
  textarea::placeholder { color: var(--text-muted); }
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
    background: var(--warning-bg);
    color: var(--warning);
    padding: 8px 10px;
    border-radius: 4px;
    font-size: 12px;
  }
  .conflict p { margin: 4px 0; }
  .conflict .overdue { color: var(--danger); font-weight: 600; }
  .conflict .src { color: var(--text-muted); font-size: 11px; }
  .error {
    background: var(--danger-bg);
    color: var(--danger);
    padding: 8px 10px;
    border-radius: 4px;
    font-size: 12px;
  }
  footer {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
    padding-top: 4px;
  }
  button {
    background: var(--bg-hover);
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    padding: 6px 14px;
    cursor: pointer;
    min-height: var(--tap-size);
  }
  button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  button.primary {
    background: var(--accent);
    color: var(--accent-on);
    border-color: var(--accent);
  }
  /* Neutral disabled fill pair — --text-subtle is never a background. */
  button.primary:disabled {
    background: var(--text-muted);
    border-color: var(--text-muted);
    color: var(--text-inverse);
    cursor: wait;
  }
</style>
