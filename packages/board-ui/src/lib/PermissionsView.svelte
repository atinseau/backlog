<script lang="ts">
  import { t } from "./i18n.svelte.js";
  import {
    fetchProject,
    setAutonomyMode,
    setClaimsConfig,
  } from "./api.js";
  import type { AutonomyMode, ProjectInfo } from "./types.js";

  interface Props {
    onClose: () => void;
    onChanged?: () => void;
    embedded?: boolean;
  }

  let { onClose, onChanged, embedded = false }: Props = $props();

  let project = $state<ProjectInfo | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);

  const AUTONOMY_MODES: Array<{ value: AutonomyMode; label: string; description: string }> = [
    { value: "observe", label: "Observe", description: "Aucun run lancé. Lecture seule." },
    { value: "assist", label: "Assist", description: "Lance avec validation manuelle." },
    { value: "delegate", label: "Delegate", description: "Lance auto sauf high-risk." },
    { value: "autopilot", label: "Autopilot", description: "Lance tout, y compris high-risk." },
  ];

  async function load() {
    loading = true;
    try {
      project = await fetchProject();
      error = null;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }

  async function changeAutonomy(mode: AutonomyMode) {
    if (!project) return;
    project = { ...project, autonomy_mode: mode };
    try {
      await setAutonomyMode(mode);
      onChanged?.();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      await load();
    }
  }

  async function changeClaimsTtl(value: number) {
    if (!project) return;
    project = { ...project, claims: { ...project.claims, ttl_minutes: value } };
    try {
      await setClaimsConfig({ ttl_minutes: value });
      onChanged?.();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      await load();
    }
  }

  async function changeEnforceOnCommit(checked: boolean) {
    if (!project) return;
    project = { ...project, claims: { ...project.claims, enforce_on_commit: checked } };
    try {
      await setClaimsConfig({ enforce_on_commit: checked });
      onChanged?.();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      await load();
    }
  }

  async function changeAutoClaimOnCommit(checked: boolean) {
    if (!project) return;
    project = { ...project, claims: { ...project.claims, auto_claim_on_commit: checked } };
    try {
      await setClaimsConfig({ auto_claim_on_commit: checked });
      onChanged?.();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      await load();
    }
  }

  load();
</script>

{#snippet body()}
    <header>
      <h2>{t("permissions.title")}</h2>
      {#if !embedded}
        <button class="close" onclick={onClose}>✕</button>
      {/if}
    </header>

    {#if error}
      <div class="error">{error}</div>
    {/if}

    {#if loading}
      <div class="loading">chargement…</div>
    {:else if project}
      <section class="block">
        <h3>Projet — niveau d'autonomie</h3>
        <p class="hint">Détermine ce que l'orchestrateur a le droit de lancer sans validation.</p>
        <div class="autonomy-grid">
          {#each AUTONOMY_MODES as mode (mode.value)}
            <button
              class="autonomy-card"
              class:active={project.autonomy_mode === mode.value}
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
              value={project.claims.ttl_minutes}
              onchange={(e) => changeClaimsTtl(parseInt((e.currentTarget as HTMLInputElement).value, 10))}
            />
          </label>
          <label class="toggle">
            <input
              type="checkbox"
              checked={project.claims.enforce_on_commit}
              onchange={(e) => changeEnforceOnCommit((e.currentTarget as HTMLInputElement).checked)}
            />
            Bloquer les commits sans claim couvrant les paths
          </label>
          <label class="toggle" title="Au lieu de bloquer, le hook crée un claim ad-hoc à la volée à partir des paths staged et du nom de la branche.">
            <input
              type="checkbox"
              checked={project.claims.auto_claim_on_commit}
              onchange={(e) => changeAutoClaimOnCommit((e.currentTarget as HTMLInputElement).checked)}
            />
            Auto-claim si rien n'est posé (recommandé pour le solo)
          </label>
        </div>
      </section>

    {/if}
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
  .embedded {
    background: var(--bg-app);
    color: var(--text-primary);
    height: 100%;
    width: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .modal {
    background: var(--bg-surface);
    color: var(--text-primary);
    border-radius: 8px;
    box-shadow: var(--shadow-modal);
    max-width: 720px;
    width: 92%;
    max-height: 88vh;
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
  }
  h2 { margin: 0; font-size: 16px; }
  h3 {
    margin: 0 0 8px;
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-secondary);
  }
  .close { background: transparent; border: none; font-size: 18px; cursor: pointer; color: var(--text-secondary); }
  .error {
    background: var(--warning-bg);
    color: var(--warning);
    padding: 8px 20px;
    font-size: 12px;
  }
  .loading { padding: 32px; text-align: center; color: var(--text-muted); }

  .modal > section,
  .modal > .block {
    padding: 16px 20px;
    border-bottom: 1px solid var(--border-subtle);
  }
  .modal > section:last-of-type,
  .modal > .block:last-child {
    border-bottom: none;
  }
  .block { overflow-y: auto; }
  .hint { margin: 0 0 8px; color: var(--text-muted); font-size: 12px; }

  .autonomy-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 8px;
  }
  .autonomy-card {
    background: var(--bg-surface);
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    padding: 10px;
    text-align: left;
    cursor: pointer;
    transition: all 120ms ease;
  }
  .autonomy-card:hover { border-color: var(--text-subtle); }
  .autonomy-card.active {
    border-color: var(--accent);
    background: var(--accent-bg);
    box-shadow: 0 0 0 1px var(--accent) inset;
  }
  .autonomy-label {
    font-weight: 600;
    font-size: 13px;
    color: var(--text-primary);
  }
  .autonomy-desc {
    font-size: 11px;
    color: var(--text-muted);
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
    color: var(--text-secondary);
  }
  .claims-row label.toggle {
    flex-direction: row;
    align-items: center;
    gap: 6px;
    font-size: 12px;
  }
  .claims-row input[type="number"] {
    padding: 4px 8px;
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    width: 80px;
    font-size: 13px;
  }

  .toggle {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    cursor: pointer;
  }
</style>
