<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { fetchAllClaims } from "./api.js";
  import ClaimCard from "./ClaimCard.svelte";
  import { useTimer } from "./timer.svelte.js";
  import type { ClaimRecord } from "./types.js";

  interface Props {
    repoFilter: string | null;
    refreshSignal: number;
    onChanged?: () => void;
  }

  let { repoFilter, refreshSignal, onChanged }: Props = $props();

  let active = $state<ClaimRecord[]>([]);
  let archived = $state<ClaimRecord[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  const timer = useTimer();
  onDestroy(() => timer.release());

  async function load() {
    loading = true;
    try {
      const opts: { repo?: string } = {};
      if (repoFilter) opts.repo = repoFilter;
      const [a, ar] = await Promise.all([
        fetchAllClaims({ ...opts }),
        fetchAllClaims({ ...opts, archived: true }),
      ]);
      active = a;
      archived = ar;
      error = null;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    // re-fetch whenever the parent bumps refreshSignal or the repo filter changes
    void refreshSignal;
    void repoFilter;
    load();
  });

  function isExpired(claim: ClaimRecord): boolean {
    const t = Date.parse(claim.expires_at);
    return Number.isFinite(t) && t < timer.now;
  }

  // Pending = active, not expired, no agent attached yet (manual claim that's
  // locked the path but where no agent is formally on it). In progress = same
  // but with an agent_id resolved (or where the run-launcher created it).
  const pending = $derived(active.filter((c) => !isExpired(c) && !c.agent_id));
  const inProgress = $derived(active.filter((c) => !isExpired(c) && Boolean(c.agent_id)));
  const expired = $derived(active.filter((c) => isExpired(c)));

  onMount(() => {
    load();
  });
</script>

{#if error}
  <div class="error">{error}</div>
{/if}

<main class="claims-board">
  <section class="column">
    <header>
      <h2 title="Claim actif sans agent attribué — le verrou est posé mais aucun agent ne bosse formellement dessus">
        En attente
      </h2>
      <span class="count">{pending.length}</span>
    </header>
    <div class="cards">
      {#each pending as claim (claim.id)}
        <ClaimCard {claim} {onChanged} />
      {/each}
      {#if !loading && pending.length === 0}
        <div class="empty">—</div>
      {/if}
    </div>
  </section>

  <section class="column">
    <header>
      <h2 title="Claim actif avec un agent attribué">En cours</h2>
      <span class="count">{inProgress.length}</span>
    </header>
    <div class="cards">
      {#each inProgress as claim (claim.id)}
        <ClaimCard {claim} {onChanged} />
      {/each}
      {#if !loading && inProgress.length === 0}
        <div class="empty">—</div>
      {/if}
    </div>
  </section>

  <section class="column">
    <header>
      <h2>Expirés</h2>
      <span class="count">{expired.length}</span>
    </header>
    <div class="cards">
      {#each expired as claim (claim.id)}
        <ClaimCard {claim} {onChanged} />
      {/each}
      {#if !loading && expired.length === 0}
        <div class="empty">—</div>
      {/if}
    </div>
  </section>

  <section class="column">
    <header>
      <h2>Archivés</h2>
      <span class="count">{archived.length}</span>
    </header>
    <div class="cards scrollable">
      {#each archived as claim (claim.id)}
        <ClaimCard {claim} {onChanged} />
      {/each}
      {#if !loading && archived.length === 0}
        <div class="empty">—</div>
      {/if}
    </div>
  </section>
</main>

<style>
  .error {
    background: #fef0c7;
    color: #b54708;
    padding: 8px 24px;
    font-size: 13px;
  }
  .claims-board {
    display: grid;
    grid-template-columns: repeat(4, minmax(240px, 1fr));
    gap: 12px;
    padding: 16px;
    align-items: start;
    min-height: calc(100vh - 60px);
  }
  .column {
    background: #eef0f3;
    border-radius: 8px;
    padding: 10px;
    display: flex;
    flex-direction: column;
    min-height: 200px;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
    padding: 0 4px;
    border: none;
    background: transparent;
  }
  h2 {
    margin: 0;
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #475467;
  }
  .count {
    background: #d0d5dd;
    color: #344054;
    font-size: 11px;
    padding: 1px 7px;
    border-radius: 10px;
  }
  .cards {
    flex: 1;
    min-height: 60px;
  }
  .cards.scrollable {
    max-height: calc(100vh - 130px);
    overflow-y: auto;
  }
  .empty {
    padding: 16px 0;
    text-align: center;
    color: #98a2b3;
    font-size: 13px;
  }
  .placeholder p {
    margin: 0;
    padding: 12px 8px;
    color: #98a2b3;
    font-size: 12px;
    text-align: center;
    line-height: 1.5;
  }
  .placeholder code {
    background: #f2f4f7;
    color: #475467;
    padding: 1px 5px;
    border-radius: 3px;
    font-family: ui-monospace, monospace;
    font-size: 11px;
  }
</style>
