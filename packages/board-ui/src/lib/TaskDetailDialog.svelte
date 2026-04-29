<script lang="ts">
  import { t } from "./i18n.svelte.js";
  import { fetchTaskDetail, type SubTaskDetail, type TaskDetail } from "./api.js";
  import { formatDuration } from "./timer.svelte.js";

  interface Props {
    taskId: string;
    onClose: () => void;
    onSplit?: () => void;
    onAddSubTask?: () => void;
    // When true, the component renders inline (no backdrop, no modal
    // chrome) so it can be embedded into the RightPanel inspector.
    // The host is responsible for the surrounding chrome.
    embedded?: boolean;
  }

  let { taskId, onClose, onSplit, onAddSubTask, embedded = false }: Props = $props();

  let task = $state<TaskDetail | null>(null);
  let subtasks = $state<SubTaskDetail[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  async function load() {
    loading = true;
    try {
      const result = await fetchTaskDetail(taskId);
      task = result.task;
      subtasks = result.subtasks;
      error = null;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }

  function formatDate(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
  }

  load();
</script>

{#snippet body()}
  <header class="detail-header">
    <div class="title-block">
      {#if task}
        <span class="pri pri-{task.priority.toLowerCase()}">{task.priority}</span>
        <h2>{task.title}</h2>
      {:else}
        <h2>{t("task_detail.title")}</h2>
      {/if}
    </div>
    {#if !embedded}
      <button class="close" onclick={onClose}>✕</button>
    {/if}
  </header>

    {#if error}
      <div class="error">{error}</div>
    {/if}

    {#if loading}
      <div class="loading">…</div>
    {:else if task}
      <div class="content">
        <div class="meta-grid">
          <div class="meta-item">
            <span class="label">{t("task_detail.field.status")}</span>
            <span class="value status status-{task.status}">{task.status}</span>
          </div>
          {#if task.estimated_duration_seconds}
            <div class="meta-item">
              <span class="label">{t("task_detail.field.duration")}</span>
              <span class="value">{formatDuration(task.estimated_duration_seconds)}</span>
            </div>
          {/if}
          <div class="meta-item">
            <span class="label">{t("task_detail.field.risk")}</span>
            <span class="value risk risk-{task.planning.risk}">{task.planning.risk}</span>
          </div>
          <div class="meta-item">
            <span class="label">{t("task_detail.field.split")}</span>
            <span class="value">
              {task.planning.split_status === "done" ? t("task_detail.split.done") : t("task_detail.split.pending")}
            </span>
          </div>
        </div>

        {#if task.repo_targets.length > 0}
          <div class="chips-row">
            <span class="row-label">{t("task_detail.field.repos")}:</span>
            {#each task.repo_targets as repo (repo)}
              <span class="chip repo">{repo}</span>
            {/each}
          </div>
        {/if}
        {#if task.labels.length > 0}
          <div class="chips-row">
            <span class="row-label">{t("task_detail.field.labels")}:</span>
            {#each task.labels as label (label)}
              <span class="chip label">{label}</span>
            {/each}
          </div>
        {/if}

        <section class="section">
          <h3>{t("task_detail.section.description")}</h3>
          {#if task.description}
            <p class="description">{task.description}</p>
          {:else}
            <p class="muted">{t("task_detail.empty.description")}</p>
          {/if}
        </section>

        <section class="section">
          <h3>{t("task_detail.section.acceptance_criteria")}</h3>
          {#if task.acceptance_criteria.length > 0}
            <ul class="criteria">
              {#each task.acceptance_criteria as ac (ac)}
                <li>{ac}</li>
              {/each}
            </ul>
          {:else}
            <p class="muted">{t("task_detail.empty.acceptance_criteria")}</p>
          {/if}
        </section>

        <section class="section">
          <div class="section-header">
            <h3>{t("task_detail.section.subtasks")} ({subtasks.length})</h3>
            <div class="section-actions">
              {#if onSplit && subtasks.length === 0}
                <button onclick={onSplit}>✂ {t("task_detail.button.split")}</button>
              {/if}
              {#if onAddSubTask}
                <button onclick={onAddSubTask}>+ {t("task_detail.button.add_subtask")}</button>
              {/if}
            </div>
          </div>
          {#if subtasks.length > 0}
            <ul class="subtasks">
              {#each subtasks as sub (sub.id)}
                <li>
                  <div class="sub-header">
                    <span class="status status-{sub.status}">{sub.status}</span>
                    <span class="sub-title">{sub.title}</span>
                    <span class="risk risk-{sub.risk}">{sub.risk}</span>
                  </div>
                  <div class="sub-line">
                    <span class="chip repo">{sub.repo}</span>
                    {#if sub.estimated_duration_seconds}
                      <span class="muted">~{formatDuration(sub.estimated_duration_seconds)}</span>
                    {/if}
                    {#if sub.progress_percent !== undefined}
                      <span class="muted">· {sub.progress_percent}%</span>
                    {/if}
                  </div>
                  {#if sub.scopes.length > 0}
                    <div class="sub-line">
                      <span class="muted">{t("task_detail.subtask.scopes")}:</span>
                      {#each sub.scopes as scope (scope)}
                        <code class="scope">{scope}</code>
                      {/each}
                    </div>
                  {/if}
                  {#if sub.depends_on.length > 0}
                    <div class="sub-line">
                      <span class="muted">{t("task_detail.subtask.depends")}:</span>
                      {#each sub.depends_on as dep (dep)}
                        <code class="dep">{dep}</code>
                      {/each}
                    </div>
                  {/if}
                </li>
              {/each}
            </ul>
          {:else}
            <p class="muted">{t("task_detail.empty.subtasks")}</p>
          {/if}
        </section>

        {#if task.dependencies.length > 0}
          <section class="section">
            <h3>{t("task_detail.section.dependencies")}</h3>
            <ul class="deps">
              {#each task.dependencies as dep (dep)}
                <li><code>{dep}</code></li>
              {/each}
            </ul>
          </section>
        {/if}

        {#if task.source_links.length > 0}
          <section class="section">
            <h3>{t("task_detail.section.source_links")}</h3>
            <ul class="links">
              {#each task.source_links as link (link.kind + ":" + link.external_id)}
                <li>
                  <span class="chip">{link.kind}</span>
                  {#if link.url}
                    <a href={link.url} target="_blank" rel="noopener noreferrer">{link.external_id}</a>
                  {:else}
                    <code>{link.external_id}</code>
                  {/if}
                </li>
              {/each}
            </ul>
          </section>
        {/if}

        <footer class="footer-meta">
          <span>{t("task_detail.created_at")}: {formatDate(task.created_at)}</span>
          <span class="dot">·</span>
          <span>{t("task_detail.updated_at")}: {formatDate(task.updated_at)}</span>
          <span class="dot">·</span>
          <code class="task-id">{task.id}</code>
        </footer>
      </div>
    {/if}
{/snippet}

{#if embedded}
  <div class="inspector">
    {@render body()}
  </div>
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
    max-width: 720px;
    width: 92%;
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  /* Embedded into the RightPanel inspector — no backdrop, no shadow,
     fills the host. */
  .inspector {
    background: var(--bg-surface);
    color: var(--text-primary);
    height: 100%;
    width: 100%;
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
  .title-block { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; }
  h2 { margin: 0; font-size: 16px; line-height: 1.3; word-wrap: break-word; }
  h3 { margin: 0 0 6px; font-size: 13px; color: #344054; font-weight: 600; }
  .pri {
    font-size: 11px;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 3px;
    color: white;
    flex-shrink: 0;
  }
  .pri-p0 { background: #d92d20; }
  .pri-p1 { background: #f79009; }
  .pri-p2 { background: #2e90fa; }
  .pri-p3 { background: #98a2b3; }
  .close {
    background: transparent;
    border: none;
    font-size: 18px;
    cursor: pointer;
    color: #475467;
  }
  .error { background: #fef0c7; color: #b54708; padding: 8px 20px; font-size: 12px; }
  .loading { padding: 40px; text-align: center; color: #667085; }
  .content { padding: 16px 20px; overflow-y: auto; flex: 1; }
  .meta-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 8px;
    margin-bottom: 12px;
  }
  .meta-item { display: flex; flex-direction: column; gap: 2px; }
  .label { font-size: 10px; color: #667085; text-transform: uppercase; letter-spacing: 0.04em; }
  .value { font-size: 13px; color: #1d2939; }
  .status, .risk {
    display: inline-block;
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 11px;
    text-transform: uppercase;
    font-weight: 600;
  }
  .status-backlog { background: #f2f4f7; color: #475467; }
  .status-ready { background: #eff8ff; color: #175cd3; }
  .status-in_progress, .status-running { background: #d1fadf; color: #027a48; }
  .status-review { background: #f4ebff; color: #6941c6; }
  .status-test { background: #fff7c0; color: #b54708; }
  .status-done, .status-released, .status-completed { background: #d1fadf; color: #027a48; }
  .status-blocked { background: #fee4e2; color: #b42318; }
  .status-queued, .status-planned, .status-waiting { background: #fef0c7; color: #b54708; }
  .status-canceled { background: #f2f4f7; color: #98a2b3; }
  .risk-low { background: #d1fadf; color: #027a48; }
  .risk-medium { background: #fef0c7; color: #b54708; }
  .risk-high { background: #fee4e2; color: #b42318; }
  .chips-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    margin-bottom: 8px;
    font-size: 12px;
  }
  .row-label { color: #667085; }
  .chip {
    background: #f2f4f7;
    color: #344054;
    padding: 2px 8px;
    border-radius: 3px;
    font-size: 11px;
  }
  .chip.repo { background: #eff8ff; color: #175cd3; }
  .chip.label { background: #fef0c7; color: #b54708; }
  .section { margin-top: 14px; }
  .section-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
  .section-actions { display: flex; gap: 6px; }
  .section-actions button {
    background: #f2f4f7;
    border: 1px solid #d0d5dd;
    border-radius: 4px;
    padding: 2px 8px;
    cursor: pointer;
    font-size: 11px;
    color: #475467;
  }
  .section-actions button:hover { background: #e4e7ec; }
  .description {
    margin: 0;
    white-space: pre-wrap;
    line-height: 1.45;
    font-size: 13px;
    color: #1d2939;
  }
  .muted { color: #98a2b3; font-size: 12px; margin: 0; font-style: italic; }
  .criteria, .deps, .links {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .criteria li {
    padding: 6px 8px;
    background: #f9fafb;
    border-left: 3px solid #98a2b3;
    border-radius: 3px;
    font-size: 12px;
  }
  .links li { display: flex; align-items: center; gap: 8px; font-size: 12px; }
  .deps li code, .links li code { font-family: ui-monospace, monospace; font-size: 11px; }
  .subtasks {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .subtasks li {
    border: 1px solid #e4e7ec;
    border-radius: 4px;
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
  }
  .sub-header { display: flex; align-items: center; gap: 8px; }
  .sub-title { flex: 1; font-weight: 500; color: #1d2939; }
  .sub-line { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 11px; }
  .scope, .dep {
    font-family: ui-monospace, monospace;
    background: #f2f4f7;
    color: #344054;
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 11px;
  }
  .footer-meta {
    margin-top: 18px;
    padding-top: 10px;
    border-top: 1px solid #e4e7ec;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: #98a2b3;
  }
  .dot { opacity: 0.5; }
  .task-id { font-family: ui-monospace, monospace; }
</style>
