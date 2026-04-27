<script lang="ts">
  import { t } from "./i18n.svelte.js";
  import {
    fetchAgents,
    fetchWorkspace,
    patchAgent,
    setAutonomyMode,
    setClaimsConfig,
  } from "./api.js";
  import type { AgentSummary, AutonomyMode, SandboxMode, ProjectInfo } from "./types.js";

  interface Props {
    availableRepos: string[];
    onClose: () => void;
    onChanged?: () => void;
  }

  let { availableRepos, onClose, onChanged }: Props = $props();

  let workspace = $state<ProjectInfo | null>(null);
  let agents = $state<AgentSummary[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  const AUTONOMY_MODES: Array<{ value: AutonomyMode; label: string; description: string }> = [
    { value: "observe", label: "Observe", description: "Aucun run lancé. Lecture seule." },
    { value: "assist", label: "Assist", description: "Lance avec validation manuelle." },
    { value: "delegate", label: "Delegate", description: "Lance auto sauf high-risk." },
    { value: "autopilot", label: "Autopilot", description: "Lance tout, y compris high-risk." },
  ];

  const SANDBOX_MODES: Array<{ value: SandboxMode | "default"; label: string; help: string }> = [
    { value: "default", label: "(défaut agent)", help: "Reprend la valeur par défaut du provider" },
    { value: "read-only", label: "Read-only", help: "Lecture du repo, aucune écriture." },
    { value: "workspace-write", label: "Workspace-write", help: "Écriture sandbox autorisée." },
    { value: "danger-full-access", label: "⚠ Full access", help: "Aucune restriction. Dangereux." },
  ];

  const ALL_RISKS: Array<"low" | "medium" | "high"> = ["low", "medium", "high"];

  async function load() {
    loading = true;
    try {
      const [w, a] = await Promise.all([fetchWorkspace(), fetchAgents()]);
      workspace = w;
      agents = a;
      error = null;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }

  async function changeAutonomy(mode: AutonomyMode) {
    if (!workspace) return;
    workspace = { ...workspace, autonomy_mode: mode };
    try {
      await setAutonomyMode(mode);
      onChanged?.();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      await load();
    }
  }

  async function changeClaimsTtl(value: number) {
    if (!workspace) return;
    workspace = { ...workspace, claims: { ...workspace.claims, ttl_minutes: value } };
    try {
      await setClaimsConfig({ ttl_minutes: value });
      onChanged?.();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      await load();
    }
  }

  async function changeEnforceOnCommit(checked: boolean) {
    if (!workspace) return;
    workspace = { ...workspace, claims: { ...workspace.claims, enforce_on_commit: checked } };
    try {
      await setClaimsConfig({ enforce_on_commit: checked });
      onChanged?.();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      await load();
    }
  }

  async function patchAgentField(id: string, input: Parameters<typeof patchAgent>[1]) {
    try {
      await patchAgent(id, input);
      await load();
      onChanged?.();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  function toggleAgentRepo(agent: AgentSummary, repo: string) {
    const next = agent.allowed_repos.includes(repo)
      ? agent.allowed_repos.filter((r) => r !== repo)
      : [...agent.allowed_repos, repo];
    patchAgentField(agent.id, { allowed_repos: next });
  }

  function toggleAgentRisk(agent: AgentSummary, risk: "low" | "medium" | "high") {
    const next = agent.allowed_risk.includes(risk)
      ? agent.allowed_risk.filter((r) => r !== risk)
      : [...agent.allowed_risk, risk];
    patchAgentField(agent.id, { allowed_risk: next });
  }

  function changeSandbox(agent: AgentSummary, value: string) {
    if (value === "default") {
      patchAgentField(agent.id, { sandbox_mode: null });
    } else {
      patchAgentField(agent.id, { sandbox_mode: value as SandboxMode });
    }
  }

  function changeSuccessMode(agent: AgentSummary, value: string) {
    if (value === "default") {
      patchAgentField(agent.id, { success_mode: null });
    } else {
      patchAgentField(agent.id, { success_mode: value as "review" | "complete" });
    }
  }

  load();
</script>

<div class="backdrop" onclick={onClose} role="presentation">
  <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
    <header>
      <h2>{t("permissions.title")}</h2>
      <button class="close" onclick={onClose}>✕</button>
    </header>

    {#if error}
      <div class="error">{error}</div>
    {/if}

    {#if loading}
      <div class="loading">chargement…</div>
    {:else if workspace}
      <section class="block">
        <h3>Workspace — niveau d'autonomie</h3>
        <p class="hint">Détermine ce que l'orchestrateur a le droit de lancer sans validation.</p>
        <div class="autonomy-grid">
          {#each AUTONOMY_MODES as mode (mode.value)}
            <button
              class="autonomy-card"
              class:active={workspace.autonomy_mode === mode.value}
              onclick={() => changeAutonomy(mode.value)}
            >
              <div class="autonomy-label">{mode.label}</div>
              <div class="autonomy-desc">{mode.description}</div>
            </button>
          {/each}
        </div>
      </section>

      <section class="block">
        <h3>Claims</h3>
        <div class="claims-row">
          <label>
            TTL par défaut (min)
            <input
              type="number"
              min="1"
              value={workspace.claims.ttl_minutes}
              onchange={(e) => changeClaimsTtl(parseInt((e.currentTarget as HTMLInputElement).value, 10))}
            />
          </label>
          <label class="toggle">
            <input
              type="checkbox"
              checked={workspace.claims.enforce_on_commit}
              onchange={(e) => changeEnforceOnCommit((e.currentTarget as HTMLInputElement).checked)}
            />
            Bloquer les commits sans claim couvrant les paths
          </label>
        </div>
      </section>

      <section class="block">
        <h3>Agents <span class="size">({agents.length})</span></h3>
        {#if agents.length === 0}
          <p class="hint">Aucun agent configuré. Ajoute-en via <code>backlog agents add</code>.</p>
        {/if}
        <ul class="agents">
          {#each agents as agent (agent.id)}
            <li class:disabled={!agent.enabled}>
              <header class="agent-header">
                <div>
                  <strong>{agent.id}</strong>
                  <span class="provider">{agent.provider}{agent.model ? ` · ${agent.model}` : ""}</span>
                </div>
                <label class="toggle">
                  <input
                    type="checkbox"
                    checked={agent.enabled}
                    onchange={(e) => patchAgentField(agent.id, { enabled: (e.currentTarget as HTMLInputElement).checked })}
                  />
                  {agent.enabled ? "activé" : "désactivé"}
                </label>
              </header>

              <div class="agent-row">
                <label>
                  Concurrence
                  <input
                    type="number"
                    min="1"
                    value={agent.max_concurrent_runs}
                    onchange={(e) => patchAgentField(agent.id, { max_concurrent_runs: parseInt((e.currentTarget as HTMLInputElement).value, 10) })}
                  />
                </label>
                <label>
                  Sandbox
                  <select
                    value={agent.sandbox_mode ?? "default"}
                    onchange={(e) => changeSandbox(agent, (e.currentTarget as HTMLSelectElement).value)}
                  >
                    {#each SANDBOX_MODES as mode (mode.value)}
                      <option value={mode.value}>{mode.label}</option>
                    {/each}
                  </select>
                </label>
                <label>
                  Success mode
                  <select
                    value={agent.success_mode ?? "default"}
                    onchange={(e) => changeSuccessMode(agent, (e.currentTarget as HTMLSelectElement).value)}
                  >
                    <option value="default">(défaut)</option>
                    <option value="review">review</option>
                    <option value="complete">complete</option>
                  </select>
                </label>
              </div>

              <div class="chips-row">
                <span class="chips-label">Risques autorisés :</span>
                {#each ALL_RISKS as risk (risk)}
                  <label class="chip risk-{risk}" class:on={agent.allowed_risk.includes(risk)}>
                    <input
                      type="checkbox"
                      checked={agent.allowed_risk.includes(risk)}
                      onchange={() => toggleAgentRisk(agent, risk)}
                    />
                    {risk}
                  </label>
                {/each}
              </div>

              <div class="chips-row">
                <span class="chips-label">Repos autorisés :</span>
                {#each availableRepos as repo (repo)}
                  <label class="chip" class:on={agent.allowed_repos.includes(repo)}>
                    <input
                      type="checkbox"
                      checked={agent.allowed_repos.includes(repo)}
                      onchange={() => toggleAgentRepo(agent, repo)}
                    />
                    {repo}
                  </label>
                {/each}
              </div>

              {#if agent.capabilities.length > 0}
                <div class="capabilities">
                  <span class="chips-label">Capabilities :</span>
                  {#each agent.capabilities as cap (cap)}
                    <span class="chip readonly">{cap}</span>
                  {/each}
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      </section>
    {/if}
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
    max-width: 720px;
    width: 92%;
    max-height: 88vh;
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
  h3 {
    margin: 0 0 8px;
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #475467;
  }
  .size { color: #98a2b3; font-weight: 400; }
  .close { background: transparent; border: none; font-size: 18px; cursor: pointer; color: #475467; }
  .error {
    background: #fef0c7;
    color: #b54708;
    padding: 8px 20px;
    font-size: 12px;
  }
  .loading { padding: 32px; text-align: center; color: #667085; }

  .modal > section,
  .modal > .block {
    padding: 16px 20px;
    border-bottom: 1px solid #f0f0f0;
  }
  .modal > section:last-of-type,
  .modal > .block:last-child {
    border-bottom: none;
  }
  .block { overflow-y: auto; }
  .hint { margin: 0 0 8px; color: #667085; font-size: 12px; }

  .autonomy-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 8px;
  }
  .autonomy-card {
    background: white;
    border: 1px solid #d0d5dd;
    border-radius: 6px;
    padding: 10px;
    text-align: left;
    cursor: pointer;
    transition: all 120ms ease;
  }
  .autonomy-card:hover { border-color: #98a2b3; }
  .autonomy-card.active {
    border-color: #1570ef;
    background: #eff8ff;
    box-shadow: 0 0 0 1px #1570ef inset;
  }
  .autonomy-label {
    font-weight: 600;
    font-size: 13px;
    color: #1d2939;
  }
  .autonomy-desc {
    font-size: 11px;
    color: #667085;
    margin-top: 2px;
  }

  .claims-row {
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
  }
  .claims-row label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    color: #475467;
  }
  .claims-row label.toggle {
    flex-direction: row;
    align-items: center;
    gap: 6px;
    font-size: 12px;
  }
  .claims-row input[type="number"] {
    padding: 4px 8px;
    border: 1px solid #d0d5dd;
    border-radius: 4px;
    width: 80px;
    font-size: 13px;
  }

  .agents {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .agents li {
    border: 1px solid #e4e7ec;
    border-radius: 6px;
    padding: 12px;
    background: #fafafa;
  }
  .agents li.disabled { opacity: 0.5; }
  .agent-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
    border: none;
    padding: 0;
  }
  .provider {
    font-size: 11px;
    color: #667085;
    margin-left: 6px;
  }
  .toggle {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    cursor: pointer;
  }
  .agent-row {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
    margin-bottom: 8px;
  }
  .agent-row label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 11px;
    color: #475467;
  }
  .agent-row input,
  .agent-row select {
    padding: 4px 6px;
    border: 1px solid #d0d5dd;
    border-radius: 4px;
    font-size: 12px;
    background: white;
  }

  .chips-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 6px;
    font-size: 12px;
  }
  .chips-label {
    color: #667085;
    margin-right: 4px;
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
  .chip.on {
    background: #eff8ff;
    border-color: #1570ef;
    color: #175cd3;
  }
  .chip.readonly { cursor: default; background: #f2f4f7; color: #475467; }
  .chip input { display: none; }
  .risk-low.on { background: #d1fadf; border-color: #027a48; color: #027a48; }
  .risk-medium.on { background: #fef0c7; border-color: #b54708; color: #b54708; }
  .risk-high.on { background: #fee4e2; border-color: #b42318; color: #b42318; }
  .capabilities {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 4px;
  }
  code {
    font-family: ui-monospace, monospace;
    background: #f2f4f7;
    padding: 1px 4px;
    border-radius: 3px;
    font-size: 11px;
  }
</style>
