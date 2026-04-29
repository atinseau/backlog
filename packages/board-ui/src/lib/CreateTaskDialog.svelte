<script lang="ts">
  import {
    applySplitProposal,
    createTask,
    fetchAgents,
    fetchUsers,
    suggestSplit,
    type CreatedTask,
    type ProposedTask,
  } from "./api.js";
  import { t } from "./i18n.svelte.js";
  import type { AgentSummary, UserSummary } from "./types.js";

  interface Props {
    availableRepos: string[];
    onClose: () => void;
    onCreated?: (result: { taskId: string; subTasksCreated: number }) => void;
  }

  let { availableRepos, onClose, onCreated }: Props = $props();

  type Phase = "input" | "creating" | "splitting" | "proposal" | "applying" | "applied";

  let phase = $state<Phase>("input");
  let title = $state("");
  let description = $state("");
  let priority = $state<"P0" | "P1" | "P2" | "P3">("P2");
  let repoTargets = $state<string[]>([]);
  let error = $state<string | null>(null);

  // Execution defaults the user picks at task creation time. Inherited
  // by the sub-task auto-shim and (eventually) by AI-split sub-tasks.
  let manualApproval = $state(false);
  let autoSplit = $state(false); // ask AI to split into sub-tasks

  // Assignee for the (future) sub-task. Empty = "auto" (let the
  // orchestrator rank). Otherwise either an AI agent id or a human
  // user id (we treat them homogeneously — preferred_agents on the
  // sub-task accepts either).
  let assigneeId = $state<string>("");
  let agentOptions = $state<AgentSummary[]>([]);
  let userOptions = $state<UserSummary[]>([]);

  // Load assignee candidates lazily on mount. Failures are silent —
  // the dropdown just falls back to "Auto" only.
  async function loadAssignees() {
    const [agents, users] = await Promise.all([
      fetchAgents().catch(() => []),
      fetchUsers().catch(() => []),
    ]);
    agentOptions = agents.filter((a) => a.provider === "claude" || a.provider === "codex" || a.provider === "custom");
    userOptions = users.filter((u) => u.status === "active");
  }
  loadAssignees();

  let createdTask = $state<CreatedTask | null>(null);
  let proposalTasks = $state<ProposedTask[]>([]);
  let proposalRationale = $state("");
  let proposalModel = $state("");
  let aiUnavailable = $state(false);
  let aiUnavailableDetail = $state("");

  function toggleRepo(id: string) {
    repoTargets = repoTargets.includes(id) ? repoTargets.filter((r) => r !== id) : [...repoTargets, id];
  }

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    error = null;
    aiUnavailable = false;
    aiUnavailableDetail = "";
    phase = "creating";
    try {
      const input: Parameters<typeof createTask>[0] = {
        title: title.trim(),
        priority,
      };
      if (description.trim()) input.description = description.trim();
      if (repoTargets.length > 0) input.repo_targets = repoTargets;
      input.manual_approval_required = manualApproval;
      // Empty assignee = "auto" (orchestrator picks). Anything else
      // (agent id or user id) goes into preferred_agents and is
      // inherited by the auto-shim sub-task or by split sub-tasks.
      if (assigneeId) input.preferred_agents = [assigneeId];
      const task = await createTask(input);
      createdTask = task;
      // Only kick the AI splitter when the user explicitly opts in.
      // Most tasks (one HTML file, one fix, one PR) shouldn't be split;
      // splitting is for genuinely parallel-able multi-repo work.
      if (autoSplit && (repoTargets.length > 0 || availableRepos.length > 0)) {
        phase = "splitting";
        const result = await suggestSplit(task.id);
        if (result.ok) {
          proposalTasks = result.proposal.tasks.map((t) => ({ ...t }));
          proposalRationale = result.proposal.rationale;
          proposalModel = result.proposal.model;
          phase = "proposal";
        } else {
          aiUnavailable = true;
          aiUnavailableDetail = result.detail;
          phase = "applied";
          onCreated?.({ taskId: task.id, subTasksCreated: 0 });
        }
      } else {
        phase = "applied";
        onCreated?.({ taskId: task.id, subTasksCreated: 0 });
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      phase = "input";
    }
  }

  async function applyProposal() {
    if (!createdTask) return;
    error = null;
    phase = "applying";
    try {
      const result = await applySplitProposal(createdTask.id, proposalTasks);
      const count = result.created_tasks.length;
      phase = "applied";
      onCreated?.({ taskId: createdTask.id, subTasksCreated: count });
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      phase = "proposal";
    }
  }

  function skipSplit() {
    if (!createdTask) return;
    phase = "applied";
    onCreated?.({ taskId: createdTask.id, subTasksCreated: 0 });
  }

  function updateProposalTask(index: number, patch: Partial<ProposedTask>) {
    proposalTasks = proposalTasks.map((task, i) => (i === index ? { ...task, ...patch } : task));
  }

  function removeProposalTask(index: number) {
    proposalTasks = proposalTasks.filter((_, i) => i !== index);
  }
</script>

<div class="backdrop" onclick={onClose} role="presentation">
  <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex={-1} onkeydown={(e) => { if (e.key === "Escape") onClose(); }}>
    <header>
      <h2>
        {#if phase === "input" || phase === "creating"}
          {t("create_task.title.input")}
        {:else if phase === "splitting"}
          {t("create_task.title.splitting")}
        {:else if phase === "proposal"}
          {t("create_task.title.proposal")}
        {:else if phase === "applying"}
          {t("create_task.title.applying")}
        {:else}
          {t("create_task.title.applied")}
        {/if}
      </h2>
      <button type="button" class="close" onclick={onClose}>✕</button>
    </header>

    {#if error}
      <div class="error">{error}</div>
    {/if}

    {#if phase === "input" || phase === "creating"}
      <form class="body" onsubmit={handleSubmit}>
        <label>
          {t("create_task.field.title")}
          <input type="text" bind:value={title} required />
        </label>

        <label>
          {t("create_task.field.description")}
          <textarea bind:value={description} rows="3" placeholder={t("create_task.field.description_help")}></textarea>
        </label>

        <label>
          {t("create_task.field.priority")}
          <select bind:value={priority}>
            <option value="P0">{t("create_task.field.priority.p0")}</option>
            <option value="P1">{t("create_task.field.priority.p1")}</option>
            <option value="P2">{t("create_task.field.priority.p2")}</option>
            <option value="P3">{t("create_task.field.priority.p3")}</option>
          </select>
        </label>

        {#if availableRepos.length > 0}
          <div class="repos">
            <span class="label">{t("create_task.field.repos")}</span>
            {#each availableRepos as repo (repo)}
              <label class="chip">
                <input type="checkbox" checked={repoTargets.includes(repo)} onchange={() => toggleRepo(repo)} />
                {repo}
              </label>
            {/each}
          </div>
        {/if}

        <label>
          {t("create_task.field.assignee")}
          <select bind:value={assigneeId}>
            <option value="">{t("create_task.assignee.auto")}</option>
            {#if agentOptions.length > 0}
              <optgroup label={t("create_task.assignee.group_ai")}>
                {#each agentOptions as agent (agent.id)}
                  <option value={agent.id} disabled={agent.needs_api_key}>
                    {agent.id}{agent.needs_api_key ? " 🔑" : ""}
                  </option>
                {/each}
              </optgroup>
            {/if}
            {#if userOptions.length > 0}
              <optgroup label={t("create_task.assignee.group_human")}>
                {#each userOptions as user (user.id)}
                  <option value={user.id}>{user.display_name} · {user.email}</option>
                {/each}
              </optgroup>
            {/if}
          </select>
          <span class="field-hint">{t("create_task.assignee.hint")}</span>
        </label>

        <fieldset class="execution">
          <legend>{t("create_task.execution.title")}</legend>
          <label class="toggle">
            <input type="checkbox" bind:checked={autoSplit} />
            <span>
              <span class="toggle-label">{t("create_task.execution.auto_split")}</span>
              <span class="toggle-desc">{t("create_task.execution.auto_split_desc")}</span>
            </span>
          </label>
          <label class="toggle">
            <input type="checkbox" bind:checked={manualApproval} />
            <span>
              <span class="toggle-label">{t("create_task.execution.manual_approval")}</span>
              <span class="toggle-desc">{t("create_task.execution.manual_approval_desc")}</span>
            </span>
          </label>
          <p class="hint">{t("create_task.execution.worktree_note")}</p>
        </fieldset>

        <footer>
          <button type="button" onclick={onClose}>{t("create_task.button.cancel")}</button>
          <button type="submit" class="primary" disabled={phase === "creating" || !title.trim()}>
            {phase === "creating" ? t("create_task.button.submitting") : t("create_task.button.submit")}
          </button>
        </footer>
      </form>
    {:else if phase === "splitting"}
      <div class="body centered">
        <div class="spinner" aria-hidden="true">⟳</div>
        <p>{t("create_task.splitting.body")}</p>
        <p class="muted">{t("create_task.splitting.help")}</p>
      </div>
    {:else if phase === "proposal"}
      <div class="body">
        <p class="rationale"><strong>{t("create_task.proposal.rationale")}</strong> ({proposalModel}) — {proposalRationale}</p>
        {#if proposalTasks.length === 0}
          <p class="muted">{t("create_task.proposal.empty")}</p>
        {:else}
          <ul class="proposed">
            {#each proposalTasks as task, i (i)}
              <li class="proposed-item">
                <div class="proposed-row">
                  <input
                    class="proposed-title"
                    type="text"
                    bind:value={task.title}
                    placeholder={t("create_task.field.title")}
                  />
                  <select bind:value={task.repo}>
                    {#each availableRepos as repo (repo)}
                      <option value={repo}>{repo}</option>
                    {/each}
                  </select>
                  <select bind:value={task.risk}>
                    <option value="low">low</option>
                    <option value="medium">medium</option>
                    <option value="high">high</option>
                  </select>
                  <button type="button" class="remove" onclick={() => removeProposalTask(i)} title={t("create_task.proposal.remove")}>✕</button>
                </div>
                {#if task.scopes.length > 0}
                  <div class="scopes">{task.scopes.join(" · ")}</div>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
        <footer>
          <button type="button" onclick={skipSplit}>{t("create_task.proposal.button.skip")}</button>
          <button
            type="button"
            class="primary"
            onclick={applyProposal}
            disabled={proposalTasks.length === 0}
          >
            {t("create_task.proposal.button.apply", { count: proposalTasks.length })}
          </button>
        </footer>
      </div>
    {:else if phase === "applying"}
      <div class="body centered">
        <div class="spinner" aria-hidden="true">⟳</div>
        <p>{t("create_task.applying.body")}</p>
      </div>
    {:else if phase === "applied"}
      <div class="body centered">
        <p class="success">{t("create_task.applied.success")}</p>
        {#if aiUnavailable}
          <p class="muted">{t("create_task.applied.ai_unavailable", { detail: aiUnavailableDetail })}</p>
        {/if}
        <footer>
          <button type="button" class="primary" onclick={onClose}>{t("create_task.applied.close")}</button>
        </footer>
      </div>
    {/if}
  </div>
</div>

<style>
  .execution {
    border: 1px solid var(--border-default);
    border-radius: 6px;
    padding: 8px 12px 6px;
    background: var(--bg-elevated);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .execution legend {
    padding: 0 4px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
    font-weight: 600;
  }
  .toggle {
    display: flex; align-items: flex-start; gap: 8px;
    cursor: pointer;
  }
  .toggle input[type="checkbox"] {
    width: 14px; height: 14px;
    margin-top: 2px;
    accent-color: var(--accent);
    flex-shrink: 0;
  }
  .toggle-label {
    display: block; font-size: 13px; color: var(--text-primary);
  }
  .toggle-desc {
    display: block; font-size: 11px; color: var(--text-muted); margin-top: 1px;
  }
  .hint {
    margin: 4px 0 0;
    font-size: 11px;
    color: var(--text-subtle);
    font-style: italic;
  }
  .field-hint {
    display: block;
    margin-top: 3px;
    font-size: 11px;
    color: var(--text-muted);
  }
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
    background: var(--bg-surface);
    border-radius: 8px;
    box-shadow: 0 20px 24px rgba(16, 24, 40, 0.18);
    max-width: 640px;
    width: 92%;
    display: flex;
    flex-direction: column;
    max-height: 85vh;
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
  .body {
    padding: 16px 20px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    overflow-y: auto;
  }
  .body.centered {
    align-items: center;
    text-align: center;
    padding: 32px 20px;
  }
  .spinner {
    font-size: 32px;
    color: var(--accent);
    animation: spin 1.2s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .muted { color: var(--text-subtle); font-size: 12px; }
  .success { color: var(--success); font-size: 16px; font-weight: 600; }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    color: var(--text-secondary);
  }
  input, select, textarea {
    padding: 6px 8px;
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    font-size: 13px;
    font-family: inherit;
  }
  textarea { resize: vertical; }
  .repos {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
    font-size: 12px;
    color: var(--text-secondary);
  }
  .repos .label { margin-right: 4px; }
  .chip {
    flex-direction: row !important;
    align-items: center;
    gap: 4px;
    padding: 2px 6px;
    background: var(--bg-hover);
    border: 1px solid var(--border-strong);
    border-radius: 3px;
    cursor: pointer;
  }
  .rationale {
    background: var(--accent-bg);
    border-radius: 6px;
    padding: 10px 12px;
    font-size: 12px;
    color: var(--accent-hover);
    margin: 0;
    line-height: 1.5;
  }
  .proposed {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .proposed-item {
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    padding: 8px 10px;
    background: var(--bg-muted);
  }
  .proposed-row {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .proposed-title { flex: 1; }
  .scopes {
    margin-top: 4px;
    font-size: 11px;
    color: var(--text-subtle);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .remove {
    background: transparent;
    border: 1px solid var(--danger);
    color: var(--danger);
    border-radius: 3px;
    padding: 2px 8px;
    cursor: pointer;
    font-size: 11px;
  }
  .remove:hover { background: var(--danger-bg); }
  footer {
    margin-top: 8px;
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  button {
    background: var(--bg-hover);
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    padding: 6px 12px;
    cursor: pointer;
    font-size: 13px;
  }
  button.primary {
    background: var(--accent);
    color: white;
    border-color: var(--accent);
  }
  button.primary:disabled {
    background: var(--text-subtle);
    border-color: var(--text-subtle);
    cursor: not-allowed;
  }
</style>
