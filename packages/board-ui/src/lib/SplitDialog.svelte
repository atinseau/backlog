<script lang="ts">
  import { splitWorkItem, type SplitInput, type SplitResult } from "./api.js";
  import type { WorkItemCard } from "./types.js";

  interface Props {
    workItem: WorkItemCard;
    availableRepos: string[];
    onClose: () => void;
    onSplit: (result: SplitResult) => void;
  }

  let { workItem, availableRepos, onClose, onSplit }: Props = $props();

  const initialRepos = workItem.repo_targets.length > 0
    ? workItem.repo_targets
    : availableRepos.slice(0, 1);

  let selectedRepos = $state<string[]>([...initialRepos]);
  let mode = $state<"parallel" | "serial">("parallel");
  let scopesByRepo = $state<Record<string, string>>({});
  let risk = $state<"low" | "medium" | "high">("medium");
  let force = $state(workItem.tasks.length > 0);
  let submitting = $state(false);
  let error = $state<string | null>(null);

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

  async function handleSubmit(event: Event) {
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

    <form onsubmit={handleSubmit}>
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
    width: min(520px, 90vw);
    max-height: 90vh;
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
  textarea {
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
