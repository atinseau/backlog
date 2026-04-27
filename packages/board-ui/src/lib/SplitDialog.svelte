<script lang="ts">
  import {
    applySplitProposal,
    splitWorkItem,
    suggestSplit,
    type ProposedTask,
    type SplitInput,
    type SplitResult,
  } from "./api.js";
  import type { WorkItemCard } from "./types.js";

  interface Props {
    workItem: WorkItemCard;
    availableRepos: string[];
    onClose: () => void;
    onSplit: (result: SplitResult) => void;
  }

  let { workItem, availableRepos, onClose, onSplit }: Props = $props();

  type ViewMode = "manual" | "ai-loading" | "ai-proposal";

  const initialRepos = workItem.repo_targets.length > 0
    ? workItem.repo_targets
    : availableRepos.slice(0, 1);

  let view = $state<ViewMode>("manual");
  let selectedRepos = $state<string[]>([...initialRepos]);
  let mode = $state<"parallel" | "serial">("parallel");
  let scopesByRepo = $state<Record<string, string>>({});
  let risk = $state<"low" | "medium" | "high">("medium");
  let force = $state(workItem.tasks.length > 0);
  let submitting = $state(false);
  let error = $state<string | null>(null);

  let aiTasks = $state<ProposedTask[]>([]);
  let aiRationale = $state<string>("");
  let aiModel = $state<string>("");

  function toggleRepo(repo: string) {
    if (selectedRepos.includes(repo)) {
      selectedRepos = selectedRepos.filter((r) => r !== repo);
    } else {
      selectedRepos = [...selectedRepos, repo];
    }
  }

  function parseScopes(raw: string): string[] {
    return raw
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  function joinScopes(scopes: string[]): string {
    return scopes.join("\n");
  }

  async function requestSuggestion() {
    error = null;
    view = "ai-loading";
    const result = await suggestSplit(workItem.id);
    if (result.ok) {
      aiTasks = result.proposal.tasks.map((task) => ({ ...task }));
      aiRationale = result.proposal.rationale;
      aiModel = result.proposal.model;
      view = "ai-proposal";
    } else {
      error = result.detail;
      view = "manual";
    }
  }

  async function handleManualSubmit(event: Event) {
    event.preventDefault();
    error = null;
    if (selectedRepos.length === 0) {
      error = "Select at least one repo";
      return;
    }
    submitting = true;
    try {
      const scope_by_repo: Record<string, string[]> = {};
      for (const repo of selectedRepos) {
        const raw = scopesByRepo[repo] ?? "";
        const scopes = parseScopes(raw);
        if (scopes.length > 0) scope_by_repo[repo] = scopes;
      }
      const input: SplitInput = {
        repos: selectedRepos,
        mode,
        risk,
        force,
      };
      if (Object.keys(scope_by_repo).length > 0) input.scope_by_repo = scope_by_repo;
      const result = await splitWorkItem(workItem.id, input);
      onSplit(result);
      onClose();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      submitting = false;
    }
  }

  async function handleApplyProposal() {
    error = null;
    submitting = true;
    try {
      const result = await applySplitProposal(workItem.id, aiTasks, force);
      onSplit(result);
      onClose();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      submitting = false;
    }
  }

  function removeTask(index: number) {
    aiTasks = aiTasks
      .filter((_, i) => i !== index)
      .map((task) => ({
        ...task,
        depends_on_indices: task.depends_on_indices
          .filter((dep) => dep !== index)
          .map((dep) => (dep > index ? dep - 1 : dep)),
      }));
  }

  function setTaskScopes(index: number, raw: string) {
    aiTasks = aiTasks.map((task, i) =>
      i === index ? { ...task, scopes: parseScopes(raw) } : task,
    );
  }
</script>

<div class="backdrop" onclick={onClose} role="presentation">
  <div class="dialog" role="dialog" aria-modal="true" aria-label="Split work item" onclick={(e) => e.stopPropagation()}>
    <header>
      <div>
        <h2>Split work item</h2>
        <p class="meta">{workItem.title}</p>
      </div>
      <button class="close" onclick={onClose} aria-label="Close">×</button>
    </header>

    <nav class="tabs">
      <button
        class:active={view === "manual"}
        onclick={() => (view = "manual")}
        type="button"
      >Manual</button>
      <button
        class:active={view === "ai-loading" || view === "ai-proposal"}
        onclick={requestSuggestion}
        disabled={view === "ai-loading"}
        type="button"
      >🤖 Suggest with AI</button>
    </nav>

    {#if view === "ai-loading"}
      <div class="placeholder">Asking Claude…</div>
    {/if}

    {#if view === "ai-proposal" && aiTasks.length > 0}
      <div class="proposal">
        <p class="rationale">
          <span class="model">{aiModel}</span>
          {aiRationale}
        </p>

        <ul class="tasks">
          {#each aiTasks as task, index (index)}
            <li>
              <div class="task-head">
                <span class="idx">#{index + 1}</span>
                <input
                  type="text"
                  bind:value={aiTasks[index].title}
                  placeholder="SubTask title"
                />
                <select bind:value={aiTasks[index].risk} aria-label="risk">
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                </select>
                <select bind:value={aiTasks[index].repo} aria-label="repo">
                  {#each availableRepos as repo (repo)}
                    <option value={repo}>{repo}</option>
                  {/each}
                </select>
                <button class="remove" onclick={() => removeTask(index)} title="Remove" type="button">×</button>
              </div>
              <textarea
                rows="2"
                value={joinScopes(task.scopes)}
                oninput={(e) => setTaskScopes(index, (e.target as HTMLTextAreaElement).value)}
                placeholder="Scopes, one per line"
              ></textarea>
              {#if task.depends_on_indices.length > 0}
                <p class="deps">depends on: {task.depends_on_indices.map((i) => `#${i + 1}`).join(", ")}</p>
              {/if}
            </li>
          {/each}
        </ul>

        {#if workItem.tasks.length > 0}
          <label class="force">
            <input type="checkbox" bind:checked={force} />
            Append to existing {workItem.tasks.length} task(s) (force)
          </label>
        {/if}

        {#if error}
          <div class="error">{error}</div>
        {/if}

        <footer>
          <button type="button" onclick={onClose}>Cancel</button>
          <button type="button" onclick={requestSuggestion} disabled={submitting}>↻ Re-ask</button>
          <button type="button" class="primary" onclick={handleApplyProposal} disabled={submitting || aiTasks.length === 0}>
            {submitting ? "Creating…" : `Apply: create ${aiTasks.length} task${aiTasks.length === 1 ? "" : "s"}`}
          </button>
        </footer>
      </div>
    {/if}

    {#if view === "manual"}
      <form onsubmit={handleManualSubmit}>
        <fieldset>
          <legend>Repos</legend>
          {#if availableRepos.length === 0}
            <p class="hint">No repos detected on the board. Add repo_targets to this work item or to the workspace config.</p>
          {:else}
            <ul class="repos">
              {#each availableRepos as repo (repo)}
                <li>
                  <label>
                    <input
                      type="checkbox"
                      checked={selectedRepos.includes(repo)}
                      onchange={() => toggleRepo(repo)}
                    />
                    <span>{repo}</span>
                  </label>
                  {#if selectedRepos.includes(repo)}
                    <textarea
                      placeholder="Scopes (one per line, globs OK)"
                      rows="2"
                      bind:value={scopesByRepo[repo]}
                    ></textarea>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        </fieldset>

        <div class="row">
          <fieldset class="inline">
            <legend>Mode</legend>
            <label><input type="radio" bind:group={mode} value="parallel" /> Parallel</label>
            <label><input type="radio" bind:group={mode} value="serial" /> Serial (chain)</label>
          </fieldset>

          <label class="risk">
            Risk
            <select bind:value={risk}>
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
            </select>
          </label>
        </div>

        {#if workItem.tasks.length > 0}
          <label class="force">
            <input type="checkbox" bind:checked={force} />
            Append to existing {workItem.tasks.length} task(s) (force)
          </label>
        {/if}

        {#if error}
          <div class="error">{error}</div>
        {/if}

        <footer>
          <button type="button" onclick={onClose}>Cancel</button>
          <button type="submit" class="primary" disabled={submitting}>
            {submitting ? "Splitting…" : `Create ${selectedRepos.length} task${selectedRepos.length === 1 ? "" : "s"}`}
          </button>
        </footer>
      </form>
    {/if}
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
    width: min(560px, 92vw);
    max-height: 92vh;
    overflow-y: auto;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.2);
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding: 14px 16px;
    border-bottom: 1px solid #e4e7ec;
    position: sticky;
    top: 0;
    background: white;
    z-index: 1;
  }
  h2 { margin: 0; font-size: 16px; }
  .meta { margin: 4px 0 0; font-size: 12px; color: #667085; }
  .close {
    background: none;
    border: none;
    font-size: 22px;
    cursor: pointer;
    color: #667085;
  }

  .tabs {
    display: flex;
    border-bottom: 1px solid #e4e7ec;
    padding: 0 12px;
  }
  .tabs button {
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    padding: 10px 12px;
    cursor: pointer;
    font-size: 13px;
    color: #667085;
  }
  .tabs button.active {
    color: #1570ef;
    border-bottom-color: #1570ef;
    font-weight: 500;
  }
  .tabs button:hover { color: #1d2939; }
  .tabs button:disabled { color: #98a2b3; cursor: wait; }

  .placeholder {
    padding: 32px 16px;
    text-align: center;
    color: #98a2b3;
    font-size: 14px;
  }

  .proposal {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .rationale {
    margin: 0;
    padding: 8px 10px;
    background: #f0f9ff;
    color: #0e4690;
    border-radius: 4px;
    font-size: 12px;
    line-height: 1.4;
  }
  .model {
    background: rgba(0, 0, 0, 0.06);
    padding: 0 4px;
    border-radius: 3px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px;
    margin-right: 4px;
  }
  .tasks {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .tasks li {
    border: 1px solid #e4e7ec;
    border-radius: 6px;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .task-head {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .idx {
    font-size: 11px;
    color: #667085;
    background: #f2f4f7;
    padding: 2px 6px;
    border-radius: 3px;
    flex-shrink: 0;
  }
  .task-head input[type="text"] {
    flex: 1;
    font: inherit;
    padding: 4px 6px;
    border: 1px solid #d0d5dd;
    border-radius: 4px;
    font-size: 13px;
  }
  .task-head select {
    font: inherit;
    padding: 4px 6px;
    border: 1px solid #d0d5dd;
    border-radius: 4px;
    font-size: 12px;
  }
  .remove {
    background: none;
    border: none;
    cursor: pointer;
    color: #98a2b3;
    font-size: 16px;
    padding: 0 4px;
  }
  .remove:hover { color: #b42318; }
  .tasks textarea {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    padding: 6px 8px;
    border: 1px solid #d0d5dd;
    border-radius: 4px;
    resize: vertical;
  }
  .deps {
    margin: 0;
    font-size: 11px;
    color: #b54708;
  }

  form {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  fieldset {
    border: 1px solid #e4e7ec;
    border-radius: 6px;
    padding: 8px 12px;
  }
  legend {
    padding: 0 4px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #475467;
  }
  .repos {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .repos li {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .repos label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: #1d2939;
  }
  .repos textarea {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    padding: 6px 8px;
    border: 1px solid #d0d5dd;
    border-radius: 4px;
    resize: vertical;
    margin-left: 22px;
  }
  .row {
    display: flex;
    gap: 12px;
    align-items: stretch;
  }
  fieldset.inline {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 12px;
  }
  fieldset.inline label {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    margin: 0;
  }
  .risk {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    color: #344054;
  }
  .risk select {
    padding: 6px 8px;
    border: 1px solid #d0d5dd;
    border-radius: 4px;
    font: inherit;
  }
  .force {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: #344054;
  }
  .hint {
    margin: 0;
    color: #98a2b3;
    font-size: 12px;
  }
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
  }
  footer button {
    background: #f2f4f7;
    border: 1px solid #d0d5dd;
    border-radius: 4px;
    padding: 6px 14px;
    cursor: pointer;
  }
  footer button.primary {
    background: #1570ef;
    color: white;
    border-color: #1570ef;
  }
  footer button.primary:disabled {
    background: #98a2b3;
    border-color: #98a2b3;
    cursor: wait;
  }
</style>
