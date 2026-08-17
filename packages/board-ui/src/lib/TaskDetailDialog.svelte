<script lang="ts">
  import { focusTrap } from "./DialogShell.svelte";
  import { t } from "./i18n.svelte.js";
  import { fetchTaskDetail, fetchAgents, setSubTaskAssignee, type SubTaskDetail, type TaskDetail, type AgentSummary } from "./api.js";
  import { formatAgentLabel } from "./agent-label.js";
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
  let agents = $state<AgentSummary[]>([]);
  let loading = $state(true);
  let assigningId = $state<string | null>(null);
  let error = $state<string | null>(null);

  async function load() {
    loading = true;
    try {
      const [detail, agentList] = await Promise.all([
        fetchTaskDetail(taskId),
        fetchAgents().catch(() => [] as AgentSummary[]),
      ]);
      task = detail.task;
      subtasks = detail.subtasks.filter((sub) => sub.planner?.origin !== "implicit");
      agents = agentList;
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

  function currentAssignee(sub: SubTaskDetail): string {
    return sub.execution?.preferred_agents?.[0] ?? "";
  }
  function isHumanAgent(agent: AgentSummary): boolean {
    return agent.provider === "manual";
  }
  async function assign(subId: string, agentId: string) {
    assigningId = subId;
    try {
      await setSubTaskAssignee(subId, agentId || null);
      await load();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      assigningId = null;
    }
  }

  function cleanBlocker(blocker: string): string {
    const runFailure = /^run_failed:([^:]+):(.+)$/.exec(blocker);
    if (runFailure) return `${runFailure[1]} · ${runFailure[2]}`;
    return blocker;
  }

  function latestRunText(sub: SubTaskDetail): string | null {
    if (!sub.latest_run) return null;
    const bits = [sub.latest_run.id, sub.latest_run.status];
    if (sub.latest_run.agent_id) bits.push(sub.latest_run.agent_id);
    const head = bits.join(" · ");
    return sub.latest_run.result ? `${head}: ${sub.latest_run.result}` : head;
  }

  load();
</script>

{#snippet body()}
  <header class="detail-header">
    {#if embedded}
      <button class="back" onclick={onClose} title={t("task_detail.back")}>← {t("task_detail.back")}</button>
    {/if}
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
                  {#if agents.length > 0}
                    <div class="sub-line assignee-line">
                      <span class="muted">{t("task_detail.subtask.assignee")}</span>
                      <select
                        class="assignee-select"
                        value={currentAssignee(sub)}
                        disabled={assigningId === sub.id}
                        onchange={(e) => assign(sub.id, (e.currentTarget as HTMLSelectElement).value)}
                      >
                        <option value="">{t("task_detail.subtask.assignee_auto")}</option>
                        <optgroup label={t("task_detail.subtask.humans")}>
                          {#each agents.filter(isHumanAgent) as agent (agent.id)}
                            <option value={agent.id}>{formatAgentLabel(agent).withContext}</option>
                          {/each}
                        </optgroup>
                        <optgroup label={t("task_detail.subtask.ai_agents")}>
                          {#each agents.filter((a) => !isHumanAgent(a)) as agent (agent.id)}
                            <option value={agent.id} disabled={!agent.enabled}>
                              {formatAgentLabel(agent).withContext}{!agent.enabled ? " (off)" : ""}
                            </option>
                          {/each}
                        </optgroup>
                      </select>
                      {#if assigningId === sub.id}<span class="muted">…</span>{/if}
                    </div>
                  {/if}
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
                  {#if sub.blockers.length > 0}
                    <div class="sub-line blocked-line">
                      <span class="muted">{t("task_detail.subtask.blocked_by")}:</span>
                      {#each sub.blockers as blocker (blocker)}
                        <code class="blocker">{cleanBlocker(blocker)}</code>
                      {/each}
                    </div>
                  {:else if sub.status === "blocked" && latestRunText(sub)}
                    <div class="sub-line blocked-line">
                      <span class="muted">{t("task_detail.subtask.last_run")}:</span>
                      <code class="blocker">{latestRunText(sub)}</code>
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
    <div use:focusTrap class="modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex={-1} onkeydown={(e) => { if (e.key === "Escape") onClose(); }}>
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
    max-height: 85dvh;
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
    border-bottom: 1px solid var(--border-default);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .title-block { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; }
  h2 { margin: 0; font-size: 16px; line-height: 1.3; word-wrap: break-word; }
  h3 { margin: 0 0 6px; font-size: 13px; color: var(--text-body); font-weight: 600; }
  .pri {
    font-size: 11px;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 3px;
    color: var(--text-on-fill);
    flex-shrink: 0;
  }
  .pri-p0 { background: var(--priority-p0); }
  .pri-p1 { background: var(--priority-p1); }
  .pri-p2 { background: var(--priority-p2); }
  /* P3 owns its own ramp literal now; it no longer borrows
     --text-subtle, which is not a fill. */
  .pri-p3 { background: var(--priority-p3); }
  .close {
    background: transparent;
    border: none;
    font-size: 18px;
    cursor: pointer;
    color: var(--text-secondary);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: var(--tap-size);
    min-height: var(--tap-size);
    border-radius: 4px;
  }
  .back {
    background: transparent;
    border: 1px solid var(--border-field);
    border-radius: 4px;
    padding: 4px 10px;
    cursor: pointer;
    color: var(--text-secondary);
    font-size: 12px;
    flex-shrink: 0;
    min-height: var(--tap-size);
  }
  .back:hover {
    color: var(--text-primary);
    border-color: var(--border-field);
    background: var(--bg-hover);
  }
  button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .error { background: var(--warning-bg); color: var(--warning); padding: 8px 20px; font-size: 12px; }
  .loading { padding: 40px; text-align: center; color: var(--text-muted); }
  .content { padding: 16px 20px; overflow-y: auto; flex: 1; }
  .meta-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 8px;
    margin-bottom: 12px;
  }
  .meta-item { display: flex; flex-direction: column; gap: 2px; }
  .label { font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
  .value { font-size: 13px; color: var(--text-primary); }
  .status, .risk {
    display: inline-block;
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 11px;
    text-transform: uppercase;
    font-weight: 600;
  }
  .status-backlog { background: var(--bg-hover); color: var(--text-secondary); }
  .status-ready { background: var(--accent-bg); color: var(--accent-text); }
  .status-in_progress, .status-running { background: var(--success-bg); color: var(--success); }
  .status-review { background: var(--accent-bg); color: var(--apply-text); }
  .status-test { background: var(--warning-bg); color: var(--warning); }
  .status-done, .status-released, .status-completed { background: var(--success-bg); color: var(--success); }
  .status-blocked { background: var(--danger-bg); color: var(--danger); }
  .status-queued, .status-planned, .status-waiting { background: var(--warning-bg); color: var(--warning); }
  .status-canceled { background: var(--bg-hover); color: var(--text-muted); }
  .risk-low { background: var(--success-bg); color: var(--success); }
  .risk-medium { background: var(--warning-bg); color: var(--warning); }
  .risk-high { background: var(--danger-bg); color: var(--danger); }
  .chips-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    margin-bottom: 8px;
    font-size: 12px;
  }
  .row-label { color: var(--text-muted); }
  .chip {
    background: var(--bg-hover);
    color: var(--text-body);
    padding: 2px 8px;
    border-radius: 3px;
    font-size: 11px;
  }
  .chip.repo { background: var(--accent-bg); color: var(--accent-text); }
  .chip.label { background: var(--warning-bg); color: var(--warning); }
  .section { margin-top: 14px; }
  .section-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
  .section-actions { display: flex; gap: 6px; }
  .section-actions button {
    background: var(--bg-hover);
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    padding: 2px 8px;
    cursor: pointer;
    font-size: 11px;
    color: var(--text-secondary);
    min-height: var(--tap-size);
  }
  .section-actions button:hover { background: var(--border-default); }
  .description {
    margin: 0;
    white-space: pre-wrap;
    line-height: 1.45;
    font-size: 13px;
    color: var(--text-primary);
  }
  .muted { color: var(--text-muted); font-size: 12px; margin: 0; font-style: italic; }
  .criteria, .deps, .links {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  /* Was a 3px grey border-left. The rail carries no information here
     (every criterion gets the same one) and DESIGN.md reserves the
     coloured side rail for the card's priority, so it becomes a plain
     1px enclosure. */
  .criteria li {
    padding: 6px 8px;
    background: var(--bg-muted);
    border: 1px solid var(--border-default);
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
    border: 1px solid var(--border-default);
    border-radius: 4px;
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
  }
  .sub-header { display: flex; align-items: center; gap: 8px; }
  .assignee-line { gap: 6px; }
  .assignee-select {
    background: var(--bg-input);
    border: 1px solid var(--border-field);
    color: var(--text-primary);
    border-radius: 4px;
    padding: 2px 6px;
    font-size: 11px;
    font-family: inherit;
    flex: 0 0 auto;
    min-width: 180px;
  }
  .assignee-select:focus { outline: none; border-color: var(--accent); }
  .assignee-select:disabled { opacity: 0.5; cursor: not-allowed; }
  .sub-title { flex: 1; font-weight: 500; color: var(--text-primary); }
  .sub-line { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 11px; }
  .scope, .dep, .blocker {
    font-family: ui-monospace, monospace;
    background: var(--bg-hover);
    color: var(--text-body);
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 11px;
  }
  .blocked-line .blocker {
    color: var(--warning);
    background: var(--warning-bg);
    white-space: normal;
  }
  .footer-meta {
    margin-top: 18px;
    padding-top: 10px;
    border-top: 1px solid var(--border-default);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--text-muted);
  }
  /* Decorative separator between the timestamps — --text-subtle is
     exactly the non-text 3:1 floor this is for. */
  .dot { color: var(--text-subtle); }
  .task-id { font-family: ui-monospace, monospace; }
</style>
