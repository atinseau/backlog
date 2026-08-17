<script lang="ts">
  import { isExecutableAgent } from "./types.js";
  import { createAgent, deleteAgent, fetchAgents, patchAgent } from "./api.js";
  import { t } from "./i18n.svelte.js";
  import { CUSTOM_MODEL_VALUE } from "./agent-models.js";
  import {
    executableProviders,
    loadProviders,
    modelsForProvider,
    providerRequiresCommand,
  } from "./providers.svelte.js";
  import type { ProviderModelChoice } from "./types.js";
  import { formatAgentLabel } from "./agent-label.js";
  import type { AgentSummary, SandboxMode } from "./types.js";

  // Double-click rename — mirrors the ProjectsView pattern. When
  // editingId matches an agent's id we swap its label for an input.
  // Saving on Enter or blur calls patchAgent({ display_name }); empty
  // input clears the field so the auto-computed name takes back over.
  let editingId = $state<string | null>(null);
  let editingValue = $state("");
  function startRename(agent: AgentSummary, event: Event) {
    event.stopPropagation();
    editingId = agent.id;
    editingValue = agent.display_name ?? formatAgentLabel(agent).short;
  }
  async function finishRename(agent: AgentSummary) {
    const next = editingValue.trim();
    editingId = null;
    const original = agent.display_name ?? null;
    // null = "use auto-computed default". Empty string from the user
    // means "go back to default" — translate before sending.
    const value: string | null = next.length === 0 ? null : next;
    if (value === original) return;
    try {
      await patchAgent(agent.id, { display_name: value });
      onChanged?.();
      await load();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }
  function handleRenameKey(event: KeyboardEvent, agent: AgentSummary) {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      void finishRename(agent);
    } else if (event.key === "Escape") {
      event.preventDefault();
      editingId = null;
    }
  }

  interface Props {
    availableRepos: string[];
    onClose: () => void;
    onChanged?: () => void;
    onOpenApiKeys?: () => void;
    embedded?: boolean;
  }

  let { availableRepos, onClose, onChanged, onOpenApiKeys, embedded = false }: Props = $props();

  let agents = $state<AgentSummary[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let savingAgentId = $state<string | null>(null);
  let expandedId = $state<string | null>(null);
  let confirmingDeleteId = $state<string | null>(null);
  let creating = $state(false);

  // Track which agents are in "custom model" mode (the dropdown
  // shows "custom..." and a free-text input becomes editable).
  // We seed from the loaded data — any model not in the catalog is
  // automatically treated as custom.
  let customModelMode = $state<Set<string>>(new Set());

  // New-agent form state. When the user clicks "+ New agent", this
  // becomes non-null and renders the inline form. We keep the form
  // narrow (id, provider, model preset) — the full grid is available
  // via the per-agent expanded panel after creation.
  let newAgent = $state<{ id: string; provider: string; model: string; command: string } | null>(null);

  function toggleExpanded(id: string) {
    expandedId = expandedId === id ? null : id;
    confirmingDeleteId = null;
  }

  function handleHeaderKey(event: KeyboardEvent, id: string) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggleExpanded(id);
  }

  function focusOnMount(node: HTMLElement): void {
    queueMicrotask(() => node.focus());
  }

  function modelChoicesFor(provider: string): ProviderModelChoice[] {
    return modelsForProvider(provider);
  }

  function isKnownModel(provider: string, model: string | null): boolean {
    if (!model) return false;
    return modelChoicesFor(provider).some((choice) => choice.value === model);
  }

  // Derived, not a module constant: t() reads the locale store, so the
  // labels have to re-evaluate when the language changes. The mode names
  // themselves are machine values and stay untranslated.
  const SANDBOX_MODES: Array<{ value: SandboxMode | "default"; label: string; help: string }> = $derived([
    { value: "default", label: t("agents_view.sandbox.default"), help: t("agents_view.sandbox.default_help") },
    { value: "read-only", label: "read-only", help: t("agents_view.sandbox.read_only_help") },
    { value: "workspace-write", label: "project-write", help: t("agents_view.sandbox.workspace_write_help") },
    { value: "danger-full-access", label: "⚠ danger-full-access", help: t("agents_view.sandbox.full_access_help") },
  ]);

  const ALL_RISKS: Array<"low" | "medium" | "high"> = ["low", "medium", "high"];

  // Capability presets — common combos so the user can flip between
  // "read-only inspector" and "full coding agent" without typing each
  // capability by hand.
  const CAPABILITY_PRESETS: Array<{ label: string; caps: string[] }> = $derived([
    { label: t("agents_view.preset.claude_default"), caps: ["plan", "edit_code", "review"] },
    { label: t("agents_view.preset.full_access"), caps: ["plan", "edit_code", "run_tests", "review", "shell", "git_read", "git_write"] },
    { label: t("agents_view.preset.read_only"), caps: ["plan", "review"] },
  ]);

  async function load() {
    loading = true;
    try {
      // The runtime catalogue drives the model and provider pickers, so it has
      // to be in hand before the form renders.
      await loadProviders();
      agents = await fetchAgents();
      error = null;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }

  function selectModel(agent: AgentSummary, value: string) {
    if (value === CUSTOM_MODEL_VALUE) {
      // Switch to custom-input mode, leave the current model value as-is
      // so the user sees what's currently configured and can edit it.
      const next = new Set(customModelMode);
      next.add(agent.id);
      customModelMode = next;
      return;
    }
    // Drop out of custom mode if the user picked a preset.
    if (customModelMode.has(agent.id)) {
      const next = new Set(customModelMode);
      next.delete(agent.id);
      customModelMode = next;
    }
    if (value === agent.model) return;
    patchField(agent.id, { model: value });
  }

  async function handleDelete(agent: AgentSummary) {
    if (confirmingDeleteId !== agent.id) {
      confirmingDeleteId = agent.id;
      return;
    }
    confirmingDeleteId = null;
    savingAgentId = agent.id;
    try {
      await deleteAgent(agent.id);
      await load();
      onChanged?.();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      savingAgentId = null;
    }
  }

  async function handleCreate() {
    if (!newAgent) return;
    const id = newAgent.id.trim();
    if (!id) {
      error = t("agents_view.error_id_required");
      return;
    }
    creating = true;
    try {
      const input: Parameters<typeof createAgent>[0] = {
        id,
        provider: newAgent.provider,
        enabled: true,
      };
      if (newAgent.model.trim()) input.model = newAgent.model.trim();
      if (newAgent.command.trim()) input.command = newAgent.command.trim();
      await createAgent(input);
      newAgent = null;
      await load();
      onChanged?.();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      creating = false;
    }
  }

  function startCreate() {
    const first = executableProviders()[0];
    newAgent = {
      id: "",
      provider: first?.id ?? "claude-code",
      model: first?.models[0]?.value ?? "",
      command: "",
    };
  }

  async function patchField(id: string, input: Parameters<typeof patchAgent>[1]) {
    savingAgentId = id;
    try {
      await patchAgent(id, input);
      // Reload to surface any normalization the server did (e.g.
      // null vs default). Cheap — list endpoint is small.
      await load();
      onChanged?.();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      savingAgentId = null;
    }
  }

  function toggleRepo(agent: AgentSummary, repo: string) {
    const next = agent.allowed_repos.includes(repo)
      ? agent.allowed_repos.filter((r) => r !== repo)
      : [...agent.allowed_repos, repo];
    patchField(agent.id, { allowed_repos: next });
  }

  function toggleRisk(agent: AgentSummary, risk: "low" | "medium" | "high") {
    const next = agent.allowed_risk.includes(risk)
      ? agent.allowed_risk.filter((r) => r !== risk)
      : [...agent.allowed_risk, risk];
    patchField(agent.id, { allowed_risk: next });
  }

  function applyPreset(agent: AgentSummary, caps: string[]) {
    patchField(agent.id, { capabilities: caps });
  }

  function commitModel(agent: AgentSummary, raw: string) {
    const trimmed = raw.trim();
    const next = trimmed.length === 0 ? null : trimmed;
    if (next === agent.model) return;
    patchField(agent.id, { model: next });
  }

  function commitProfile(agent: AgentSummary, raw: string) {
    const trimmed = raw.trim();
    const next = trimmed.length === 0 ? null : trimmed;
    if (next === agent.profile) return;
    patchField(agent.id, { profile: next });
  }

  function commitConcurrency(agent: AgentSummary, raw: string) {
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 1) return;
    if (n === agent.max_concurrent_runs) return;
    patchField(agent.id, { max_concurrent_runs: n });
  }

  function changeSandbox(agent: AgentSummary, value: string) {
    if (value === "default") patchField(agent.id, { sandbox_mode: null });
    else patchField(agent.id, { sandbox_mode: value as SandboxMode });
  }

  function changeSuccessMode(agent: AgentSummary, value: string) {
    if (value === "default") patchField(agent.id, { success_mode: null });
    else patchField(agent.id, { success_mode: value as "review" | "complete" });
  }

  function isExecutable(agent: AgentSummary): boolean {
    return isExecutableAgent(agent);
  }

  load();
</script>

{#snippet body()}
    <header>
      <div>
        <h2>{t("agents_view.title")}</h2>
        <p class="subtitle">{t("agents_view.subtitle")}</p>
      </div>
      <div class="header-actions">
        <button
          class="btn-primary"
          onclick={startCreate}
          disabled={newAgent !== null}
          type="button"
        >+ {t("agents_view.create_button")}</button>
        {#if !embedded}
          <button class="close" onclick={onClose} aria-label={t("agents_view.close")}>✕</button>
        {/if}
      </div>
    </header>

    {#if error}
      <div class="error">{error}</div>
    {/if}

    {#if loading}
      <div class="loading">{t("agents_view.loading")}</div>
    {:else if agents.length === 0}
      <div class="loading">{t("agents_view.empty")}</div>
    {:else}
      <ul class="agents">
        {#each agents as agent (agent.id)}
          {@const isExpanded = expandedId === agent.id}
          <li class:disabled={!agent.enabled} class:not-executable={!isExecutable(agent)} class:expanded={isExpanded}>
            <div
              class="agent-header"
              role="button"
              tabindex="0"
              onclick={() => toggleExpanded(agent.id)}
              onkeydown={(e) => handleHeaderKey(e, agent.id)}
              aria-expanded={isExpanded}
            >
              <span class="chev" aria-hidden="true">{isExpanded ? "▾" : "▸"}</span>
              <div class="ident">
                {#if editingId === agent.id}
                  <!-- Inline rename input — Enter / blur saves, Escape cancels.
                       Stop propagation so clicks on the input don't toggle
                       the agent's expanded panel. -->
                  <input
                    class="rename-input"
                    type="text"
                    bind:value={editingValue}
                    onkeydown={(e) => handleRenameKey(e, agent)}
                    onblur={() => finishRename(agent)}
                    onclick={(e) => e.stopPropagation()}
                    use:focusOnMount
                  />
                {:else}
                  {@const label = formatAgentLabel(agent)}
                  <strong
                    class="agent-label"
                    title={agent.id + (agent.display_name ? ` · ${t("agents_view.rename_hint")}` : "")}
                    ondblclick={(e) => startRename(agent, e)}
                  >{label.withContext}</strong>
                {/if}
                <span class="provider provider-{agent.provider}">{agent.provider}</span>
                {#if !isExecutable(agent)}
                  <span class="warn">{t("agents_view.not_executable")}</span>
                {/if}
                {#if agent.active_runs > 0}
                  <span class="active">▶ {agent.active_runs > 1
                    ? t("agents_view.active_runs_many", { count: agent.active_runs })
                    : t("agents_view.active_runs_one", { count: agent.active_runs })}</span>
                {/if}
              </div>
              <div class="status-cell" onclick={(e) => e.stopPropagation()} role="presentation">
                {#if agent.needs_api_key}
                  <button
                    class="api-key-link"
                    type="button"
                    onclick={() => onOpenApiKeys?.()}
                    title={t("agents_view.needs_api_key_hint", { key: agent.required_secret_key ?? "" })}
                  >
                    🔑 {t("agents_view.set_api_key")}
                  </button>
                {:else if isExecutable(agent)}
                  <span class="ready-pill">✓ {t("agents_view.ready")}</span>
                {/if}
              </div>
            </div>

            {#if isExpanded}
            <div class="grid">
              <label class="field">
                <span class="lbl">{t("agents_view.field_model")}</span>
                {#if modelChoicesFor(agent.provider).length > 0}
                  {#if customModelMode.has(agent.id) || (agent.model !== null && !isKnownModel(agent.provider, agent.model))}
                    <select
                      value={CUSTOM_MODEL_VALUE}
                      disabled={!isExecutable(agent) || savingAgentId === agent.id}
                      onchange={(e) => selectModel(agent, (e.currentTarget as HTMLSelectElement).value)}
                    >
                      {#each modelChoicesFor(agent.provider) as choice (choice.value)}
                        <option value={choice.value} title={choice.description}>{choice.label}</option>
                      {/each}
                      <option value={CUSTOM_MODEL_VALUE}>{t("agents_view.model_custom")}</option>
                    </select>
                    <input
                      value={agent.model ?? ""}
                      placeholder={t("agents_view.model_placeholder")}
                      disabled={!isExecutable(agent) || savingAgentId === agent.id}
                      onchange={(e) => commitModel(agent, (e.currentTarget as HTMLInputElement).value)}
                    />
                  {:else}
                    <select
                      value={agent.model ?? ""}
                      disabled={!isExecutable(agent) || savingAgentId === agent.id}
                      onchange={(e) => selectModel(agent, (e.currentTarget as HTMLSelectElement).value)}
                    >
                      {#each modelChoicesFor(agent.provider) as choice (choice.value)}
                        <option value={choice.value} title={choice.description}>{choice.label}</option>
                      {/each}
                      <option value={CUSTOM_MODEL_VALUE}>{t("agents_view.model_custom")}</option>
                    </select>
                  {/if}
                {:else}
                  <input
                    value={agent.model ?? ""}
                    placeholder={t("agents_view.model_placeholder")}
                    disabled={!isExecutable(agent) || savingAgentId === agent.id}
                    onchange={(e) => commitModel(agent, (e.currentTarget as HTMLInputElement).value)}
                  />
                {/if}
              </label>
              <label class="field">
                <span class="lbl">{t("agents_view.field_profile")}</span>
                <input
                  value={agent.profile ?? ""}
                  placeholder={t("agents_view.profile_placeholder")}
                  disabled={!isExecutable(agent) || savingAgentId === agent.id}
                  onchange={(e) => commitProfile(agent, (e.currentTarget as HTMLInputElement).value)}
                />
              </label>
              <label class="field narrow">
                <span class="lbl">{t("agents_view.field_concurrency")}</span>
                <input
                  type="number"
                  min="1"
                  value={agent.max_concurrent_runs}
                  disabled={savingAgentId === agent.id}
                  onchange={(e) => commitConcurrency(agent, (e.currentTarget as HTMLInputElement).value)}
                />
              </label>
              <label class="field">
                <span class="lbl">{t("agents_view.field_sandbox")}</span>
                <select
                  value={agent.sandbox_mode ?? "default"}
                  disabled={savingAgentId === agent.id}
                  onchange={(e) => changeSandbox(agent, (e.currentTarget as HTMLSelectElement).value)}
                >
                  {#each SANDBOX_MODES as mode (mode.value)}
                    <option value={mode.value} title={mode.help}>{mode.label}</option>
                  {/each}
                </select>
              </label>
              <label class="field">
                <span class="lbl">{t("agents_view.field_success_mode")}</span>
                <select
                  value={agent.success_mode ?? "default"}
                  disabled={savingAgentId === agent.id}
                  onchange={(e) => changeSuccessMode(agent, (e.currentTarget as HTMLSelectElement).value)}
                >
                  <option value="default">{t("agents_view.default")}</option>
                  <option value="review">review</option>
                  <option value="complete">complete</option>
                </select>
              </label>
            </div>

            <div class="chips-row">
              <span class="lbl">{t("agents_view.field_risk")}</span>
              {#each ALL_RISKS as risk (risk)}
                <label class="chip risk-{risk}" class:on={agent.allowed_risk.includes(risk)}>
                  <input
                    type="checkbox"
                    checked={agent.allowed_risk.includes(risk)}
                    onchange={() => toggleRisk(agent, risk)}
                  />
                  {risk}
                </label>
              {/each}
            </div>

            {#if availableRepos.length > 0}
              <div class="chips-row">
                <span class="lbl">{t("agents_view.field_repos")}</span>
                <span class="hint" title={t("agents_view.repos_hint")}>
                  {agent.allowed_repos.length === 0 ? t("agents_view.repos_all") : ""}
                </span>
                {#each availableRepos as repo (repo)}
                  <label class="chip" class:on={agent.allowed_repos.includes(repo)}>
                    <input
                      type="checkbox"
                      checked={agent.allowed_repos.includes(repo)}
                      onchange={() => toggleRepo(agent, repo)}
                    />
                    {repo}
                  </label>
                {/each}
              </div>
            {/if}

            <div class="caps-row">
              <span class="lbl">{t("agents_view.field_capabilities")}</span>
              <div class="caps">
                {#each agent.capabilities as cap (cap)}
                  <span class="chip readonly">{cap}</span>
                {/each}
              </div>
              <details class="presets">
                <summary>{t("agents_view.presets")}</summary>
                <div class="preset-list">
                  {#each CAPABILITY_PRESETS as preset (preset.label)}
                    <button onclick={() => applyPreset(agent, preset.caps)}>
                      {preset.label}
                    </button>
                  {/each}
                </div>
              </details>
            </div>

            <div class="danger-row">
              {#if confirmingDeleteId === agent.id}
                <span class="confirm-prompt">{t("agents_view.delete_confirm", { id: agent.id })}</span>
                <button
                  class="btn-danger"
                  onclick={() => handleDelete(agent)}
                  disabled={savingAgentId === agent.id}
                  type="button"
                >{t("agents_view.delete_yes")}</button>
                <button
                  class="btn-secondary"
                  onclick={() => (confirmingDeleteId = null)}
                  type="button"
                >{t("agents_view.delete_cancel")}</button>
              {:else}
                <button
                  class="btn-danger-outline"
                  onclick={() => handleDelete(agent)}
                  disabled={agent.active_runs > 0 || savingAgentId === agent.id}
                  title={agent.active_runs > 0 ? t("agents_view.delete_blocked_running") : ""}
                  type="button"
                >{t("agents_view.delete_button")}</button>
              {/if}
            </div>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}

    <!-- Inline create form. Trigger sits in the header so the button
         is always visible regardless of how many agents exist. -->
    {#if newAgent}
      <div class="create-form">
        <h3>{t("agents_view.create_title")}</h3>
        <div class="create-grid">
          <label class="field">
            <span class="lbl">{t("agents_view.create_id")}</span>
            <input
              placeholder="claude-haiku"
              value={newAgent.id}
              oninput={(e) => (newAgent!.id = (e.currentTarget as HTMLInputElement).value)}
            />
          </label>
          <label class="field">
            <span class="lbl">{t("agents_view.create_provider")}</span>
            <select
              value={newAgent.provider}
              onchange={(e) => {
                if (!newAgent) return;
                newAgent.provider = (e.currentTarget as HTMLSelectElement).value;
                // Reset model to a sensible default for the new provider.
                const first = modelsForProvider(newAgent.provider)[0]?.value;
                newAgent.model = first ?? "";
              }}
            >
              {#each executableProviders() as provider (provider.id)}
                <option value={provider.id}>{provider.display_name}</option>
              {/each}
            </select>
          </label>
          <label class="field">
            <span class="lbl">{t("agents_view.field_model")}</span>
            {#if modelsForProvider(newAgent.provider).length > 0}
              <select
                value={newAgent.model}
                onchange={(e) => (newAgent!.model = (e.currentTarget as HTMLSelectElement).value)}
              >
                {#each modelsForProvider(newAgent.provider) as choice (choice.value)}
                  <option value={choice.value} title={choice.description}>{choice.label}</option>
                {/each}
              </select>
            {:else}
              <input
                placeholder={t("agents_view.model_placeholder")}
                value={newAgent.model}
                oninput={(e) => (newAgent!.model = (e.currentTarget as HTMLInputElement).value)}
              />
            {/if}
          </label>
          {#if providerRequiresCommand(newAgent.provider)}
            <label class="field">
              <span class="lbl">{t("agents_view.field_command")}</span>
              <input
                placeholder="./run-my-agent.sh"
                value={newAgent.command}
                oninput={(e) => (newAgent!.command = (e.currentTarget as HTMLInputElement).value)}
              />
            </label>
          {/if}
        </div>
        <div class="create-actions">
          <button class="btn-secondary" onclick={() => (newAgent = null)} type="button">
            {t("agents_view.create_cancel")}
          </button>
          <button
            class="btn-primary"
            onclick={handleCreate}
            disabled={creating || !newAgent.id.trim()}
            type="button"
          >{creating ? "…" : t("agents_view.create_submit")}</button>
        </div>
      </div>
    {/if}

    <footer class="hint-footer">{t("agents_view.cli_hint")}</footer>
{/snippet}

{#if embedded}
  <div class="embedded">{@render body()}</div>
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
    max-width: 760px;
    width: 92%;
    max-height: 88vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .embedded {
    background: var(--bg-app);
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
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }
  h2 { margin: 0; font-size: 16px; }
  .subtitle { margin: 4px 0 0; font-size: 12px; color: var(--text-muted); }
  /* WCAG 2.5.8: the glyph is 18px but the target floors at --tap-size. */
  .close {
    background: transparent;
    border: none;
    font-size: 18px;
    cursor: pointer;
    color: var(--text-secondary);
    min-width: var(--tap-size);
    min-height: var(--tap-size);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
  }
  .close:hover { background: var(--bg-hover); color: var(--text-primary); }
  .error {
    background: var(--danger-bg);
    color: var(--danger);
    padding: 8px 20px;
    font-size: 12px;
    border-bottom: 1px solid var(--danger-bg);
  }
  .loading {
    padding: 32px;
    text-align: center;
    color: var(--text-muted);
    font-style: italic;
  }

  ul.agents {
    list-style: none;
    margin: 0;
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    overflow-y: auto;
    flex: 1;
  }
  ul.agents li {
    border: 1px solid var(--border-default);
    border-radius: 6px;
    background: var(--bg-surface);
    overflow: hidden;
  }
  ul.agents li.disabled { background: var(--bg-elevated); }
  ul.agents li.not-executable { border-color: var(--warning); }
  ul.agents li.expanded { background: var(--bg-elevated); }

  /* Compact clickable row. Default state: 40px tall, just essentials. */
  .agent-header {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    background: transparent;
    border: none;
    padding: 8px 12px;
    cursor: pointer;
    text-align: left;
    color: var(--text-primary);
    font: inherit;
  }
  .agent-header:hover { background: var(--bg-hover); }
  .chev {
    font-size: 11px;
    color: var(--text-muted);
    flex-shrink: 0;
    width: 12px;
  }
  ul.agents li.expanded > .agent-header {
    border-bottom: 1px solid var(--border-subtle);
  }
  ul.agents li.expanded > .grid,
  ul.agents li.expanded > .chips-row,
  ul.agents li.expanded > .caps-row {
    padding-left: 12px;
    padding-right: 12px;
  }
  ul.agents li.expanded > .grid { padding-top: 12px; }
  ul.agents li.expanded > .caps-row { padding-bottom: 12px; }
  .model-pill {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px;
    background: var(--bg-input);
    color: var(--text-secondary);
    padding: 1px 6px;
    border-radius: 3px;
  }
  .ident { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .ident strong { font-size: 14px; color: var(--text-primary); }
  /* Hover hint that the label is rename-able. The cursor / underline
     mirror the .project-name affordance in ProjectsView. */
  .agent-label { cursor: text; }
  .agent-label:hover { text-decoration: underline dotted var(--text-subtle); text-underline-offset: 3px; }
  .rename-input {
    font: inherit;
    font-size: 14px;
    color: var(--text-primary);
    background: var(--bg-input);
    border: 1px solid var(--accent);
    border-radius: 4px;
    padding: 2px 6px;
    min-width: 180px;
  }
  /* No shared `color` here: each variant paints a different fill, so
     each one carries its own paired ink (DESIGN.md, encre appariée). */
  .provider {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 2px 6px;
    border-radius: 3px;
    font-weight: 600;
  }
  .provider-claude { background: var(--danger); color: var(--danger-on); }
  .provider-codex { background: var(--success); color: var(--success-on); }
  /* Neutral fill pair — --text-subtle is never a background. */
  .provider-manual { background: var(--text-muted); color: var(--text-inverse); }
  .provider-custom { background: var(--apply); color: var(--apply-on); }
  .warn {
    background: var(--warning-bg);
    color: var(--warning);
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 3px;
    font-weight: 500;
  }
  .active {
    background: var(--success-bg);
    color: var(--success);
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 3px;
    font-weight: 600;
  }

  .status-cell {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .ready-pill {
    background: var(--success-bg);
    color: var(--success);
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 3px;
    font-weight: 600;
  }
  .api-key-link {
    background: var(--warning-bg);
    color: var(--warning);
    border: 1px solid var(--warning);
    border-radius: 4px;
    padding: 4px 10px;
    font: inherit;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    min-height: var(--tap-size);
  }
  .api-key-link:hover { filter: brightness(1.05); }

  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr 80px 1fr 1fr;
    gap: 8px;
    margin-bottom: 10px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .field.narrow { max-width: 80px; }
  .lbl {
    font-size: 10px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-weight: 600;
  }
  .field input,
  .field select {
    padding: 4px 6px;
    /* Input outline: WCAG 1.4.11 asks 3:1, --border-strong gives 1.47:1. */
    border: 1px solid var(--border-field);
    border-radius: 4px;
    font-size: 12px;
    background: var(--bg-surface);
    color: var(--text-primary);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    min-height: var(--tap-size);
  }
  .field input:focus-visible,
  .field select:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .field input:disabled,
  .field select:disabled { opacity: 0.5; cursor: not-allowed; }

  .chips-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 6px;
    font-size: 12px;
  }
  .chip {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: var(--bg-surface);
    border: 1px solid var(--border-field);
    border-radius: 3px;
    padding: 2px 8px;
    cursor: pointer;
    font-size: 11px;
    min-height: var(--tap-size);
  }
  /* Visually hidden, not display:none — display:none drops the checkbox
     out of the tab order, so these toggles were mouse-only. */
  .chip input {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: 0;
    opacity: 0;
    pointer-events: none;
  }
  .chip:focus-within {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .chip.on {
    background: var(--accent-bg);
    border-color: var(--accent);
    color: var(--accent-text);
  }
  .chip.readonly { cursor: default; background: var(--bg-hover); color: var(--text-secondary); }
  .risk-low.on { background: var(--success-bg); border-color: var(--success); color: var(--success); }
  .risk-medium.on { background: var(--warning-bg); border-color: var(--warning); color: var(--warning); }
  .risk-high.on { background: var(--danger-bg); border-color: var(--danger); color: var(--danger); }
  /* Readable metadata bottoms out at --text-muted. */
  .hint { color: var(--text-muted); font-style: italic; }

  .caps-row {
    margin-top: 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .caps { display: flex; flex-wrap: wrap; gap: 4px; }
  .presets {
    margin-top: 4px;
    font-size: 11px;
  }
  .presets summary {
    cursor: pointer;
    color: var(--text-secondary);
    user-select: none;
    /* WCAG 2.5.8 floor for the disclosure target. */
    min-height: var(--tap-size);
    padding: 4px 0;
  }
  .preset-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 6px;
  }
  .preset-list button {
    background: var(--bg-surface);
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    padding: 4px 8px;
    text-align: left;
    cursor: pointer;
    font-size: 11px;
    color: var(--text-body);
  }
  .preset-list button:hover { background: var(--bg-hover); border-color: var(--border-field); }

  .header-actions {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .btn-primary {
    background: var(--accent);
    /* Paired ink: --accent lightens in dark, so the ink must flip. */
    color: var(--accent-on);
    border: none;
    border-radius: 4px;
    padding: 6px 12px;
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .btn-primary:hover:not(:disabled) { filter: brightness(1.08); }
  .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-secondary {
    background: var(--bg-input);
    color: var(--text-body);
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    padding: 5px 10px;
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .btn-secondary:hover { background: var(--bg-hover); }
  .btn-danger {
    background: var(--danger);
    /* Paired ink: --danger lightens in dark, so the ink must flip. */
    color: var(--danger-on);
    border: none;
    border-radius: 4px;
    padding: 5px 10px;
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .btn-danger:hover:not(:disabled) { filter: brightness(1.08); }
  .btn-danger-outline {
    background: transparent;
    color: var(--danger);
    border: 1px solid var(--danger);
    border-radius: 4px;
    padding: 5px 10px;
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .btn-danger-outline:hover:not(:disabled) {
    background: var(--danger-bg);
  }
  .btn-danger-outline:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .danger-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 12px;
    padding-top: 10px;
    padding-bottom: 12px;
    border-top: 1px dashed var(--border-subtle);
    flex-wrap: wrap;
  }
  .confirm-prompt {
    font-size: 12px;
    color: var(--danger);
    flex: 1;
  }

  .create-form {
    margin: 12px 16px 16px;
    padding: 16px;
    background: var(--bg-elevated);
    border: 1px solid var(--accent);
    border-radius: 6px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .create-form h3 {
    margin: 0;
    font-size: 14px;
    color: var(--text-primary);
  }
  .create-grid {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 8px;
  }
  .create-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .hint-footer {
    padding: 8px 20px;
    background: var(--bg-muted);
    border-top: 1px solid var(--border-default);
    font-size: 11px;
    color: var(--text-muted);
    flex-shrink: 0;
  }

  /* BP_COMPACT — src/lib/shell/breakpoints.ts */
  @media (max-width: 900px) {
    .grid {
      grid-template-columns: 1fr 1fr;
    }
    .field.narrow { max-width: none; }
  }
  /* BP_NARROW — src/lib/shell/breakpoints.ts */
  @media (max-width: 640px) {
    .grid,
    .create-grid {
      grid-template-columns: 1fr;
    }
    header {
      flex-direction: column;
      align-items: stretch;
    }
    .header-actions {
      justify-content: space-between;
    }
  }
</style>
