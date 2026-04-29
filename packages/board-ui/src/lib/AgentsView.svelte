<script lang="ts">
  import { fetchAgents, patchAgent } from "./api.js";
  import { t } from "./i18n.svelte.js";
  import type { AgentSummary, SandboxMode } from "./types.js";

  interface Props {
    availableRepos: string[];
    onClose: () => void;
    onChanged?: () => void;
    embedded?: boolean;
  }

  let { availableRepos, onClose, onChanged, embedded = false }: Props = $props();

  let agents = $state<AgentSummary[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let savingAgentId = $state<string | null>(null);

  // Per-provider model suggestions. Free-text input — these are just
  // hints in a datalist, the user can type whatever they want.
  // Keep current defaults conservative (sonnet over opus on claude,
  // gpt-5.4 on codex) so picking from the list doesn't surprise the
  // user with an order-of-magnitude cost change.
  const MODEL_SUGGESTIONS: Record<string, string[]> = {
    claude: ["claude-opus-4-7", "claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5"],
    codex: ["gpt-5.4", "gpt-5-codex"],
    custom: [],
    manual: [],
  };

  const SANDBOX_MODES: Array<{ value: SandboxMode | "default"; label: string; help: string }> = [
    { value: "default", label: "(défaut provider)", help: "Reprend la valeur par défaut du provider" },
    { value: "read-only", label: "read-only", help: "Lecture seule, aucune écriture." },
    { value: "workspace-write", label: "workspace-write", help: "Écriture sandbox autorisée." },
    { value: "danger-full-access", label: "⚠ danger-full-access", help: "Aucune restriction." },
  ];

  const ALL_RISKS: Array<"low" | "medium" | "high"> = ["low", "medium", "high"];

  // Capability presets — common combos so the user can flip between
  // "read-only inspector" and "full coding agent" without typing each
  // capability by hand.
  const CAPABILITY_PRESETS: Array<{ label: string; caps: string[] }> = [
    { label: "Plan + edit + review (defaut Claude)", caps: ["plan", "edit_code", "review"] },
    { label: "Plan + edit + tests + shell + git (defaut Codex)", caps: ["plan", "edit_code", "run_tests", "review", "shell", "git_read", "git_write"] },
    { label: "Lecture seule", caps: ["plan", "review"] },
  ];

  async function load() {
    loading = true;
    try {
      agents = await fetchAgents();
      error = null;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
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
    return agent.provider === "claude" || agent.provider === "codex" || agent.provider === "custom";
  }

  load();
</script>

{#snippet body()}
    <header>
      <div>
        <h2>{t("agents_view.title")}</h2>
        <p class="subtitle">{t("agents_view.subtitle")}</p>
      </div>
      {#if !embedded}
        <button class="close" onclick={onClose} aria-label={t("agents_view.close")}>✕</button>
      {/if}
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
          <li class:disabled={!agent.enabled} class:not-executable={!isExecutable(agent)}>
            <header class="agent-header">
              <div class="ident">
                <strong>{agent.id}</strong>
                <span class="provider provider-{agent.provider}">{agent.provider}</span>
                {#if !isExecutable(agent)}
                  <span class="warn">{t("agents_view.not_executable")}</span>
                {/if}
                {#if agent.active_runs > 0}
                  <span class="active">▶ {agent.active_runs} actif{agent.active_runs > 1 ? "s" : ""}</span>
                {/if}
              </div>
              <label class="toggle">
                <input
                  type="checkbox"
                  checked={agent.enabled}
                  disabled={savingAgentId === agent.id}
                  onchange={(e) => patchField(agent.id, { enabled: (e.currentTarget as HTMLInputElement).checked })}
                />
                {agent.enabled ? t("agents_view.enabled") : t("agents_view.disabled")}
              </label>
            </header>

            <div class="grid">
              <label class="field">
                <span class="lbl">{t("agents_view.field_model")}</span>
                <input
                  list="models-{agent.id}"
                  value={agent.model ?? ""}
                  placeholder={t("agents_view.model_placeholder")}
                  disabled={!isExecutable(agent) || savingAgentId === agent.id}
                  onchange={(e) => commitModel(agent, (e.currentTarget as HTMLInputElement).value)}
                />
                <datalist id="models-{agent.id}">
                  {#each MODEL_SUGGESTIONS[agent.provider] ?? [] as m (m)}
                    <option value={m}></option>
                  {/each}
                </datalist>
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
          </li>
        {/each}
      </ul>
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
    border-bottom: 1px solid #e4e7ec;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }
  h2 { margin: 0; font-size: 16px; }
  .subtitle { margin: 4px 0 0; font-size: 12px; color: #667085; }
  .close {
    background: transparent;
    border: none;
    font-size: 18px;
    cursor: pointer;
    color: #475467;
  }
  .error {
    background: #fee4e2;
    color: #b42318;
    padding: 8px 20px;
    font-size: 12px;
    border-bottom: 1px solid #fecdca;
  }
  .loading {
    padding: 32px;
    text-align: center;
    color: #667085;
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
    border: 1px solid #e4e7ec;
    border-radius: 8px;
    padding: 12px;
    background: white;
  }
  ul.agents li.disabled { background: #fafafa; opacity: 0.7; }
  ul.agents li.not-executable { border-color: #fef0c7; background: #fffaeb; }

  .agent-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
    border: none;
    padding: 0;
  }
  .ident { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .ident strong { font-size: 14px; color: #1d2939; }
  .provider {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 2px 6px;
    border-radius: 3px;
    color: white;
    font-weight: 600;
  }
  .provider-claude { background: #d92d20; }
  .provider-codex { background: #027a48; }
  .provider-manual { background: #98a2b3; }
  .provider-custom { background: #6941c6; }
  .warn {
    background: #fef0c7;
    color: #b54708;
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 3px;
    font-weight: 500;
  }
  .active {
    background: #d1fadf;
    color: #027a48;
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 3px;
    font-weight: 600;
  }

  .toggle {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    cursor: pointer;
    color: #475467;
  }

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
    color: #667085;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-weight: 600;
  }
  .field input,
  .field select {
    padding: 4px 6px;
    border: 1px solid #d0d5dd;
    border-radius: 4px;
    font-size: 12px;
    background: white;
    font-family: ui-monospace, monospace;
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
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: white;
    border: 1px solid #d0d5dd;
    border-radius: 3px;
    padding: 2px 8px;
    cursor: pointer;
    font-size: 11px;
  }
  .chip input { display: none; }
  .chip.on {
    background: #eff8ff;
    border-color: #1570ef;
    color: #175cd3;
  }
  .chip.readonly { cursor: default; background: #f2f4f7; color: #475467; }
  .risk-low.on { background: #d1fadf; border-color: #027a48; color: #027a48; }
  .risk-medium.on { background: #fef0c7; border-color: #b54708; color: #b54708; }
  .risk-high.on { background: #fee4e2; border-color: #b42318; color: #b42318; }
  .hint { color: #98a2b3; font-style: italic; }

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
    color: #475467;
    user-select: none;
  }
  .preset-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 6px;
  }
  .preset-list button {
    background: white;
    border: 1px solid #d0d5dd;
    border-radius: 4px;
    padding: 4px 8px;
    text-align: left;
    cursor: pointer;
    font-size: 11px;
    color: #344054;
  }
  .preset-list button:hover { background: #f2f4f7; border-color: #98a2b3; }

  .hint-footer {
    padding: 8px 20px;
    background: #f9fafb;
    border-top: 1px solid #e4e7ec;
    font-size: 11px;
    color: #667085;
    flex-shrink: 0;
  }

  @media (max-width: 700px) {
    .grid {
      grid-template-columns: 1fr 1fr;
    }
    .field.narrow { max-width: none; }
  }
</style>
