<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { fetchAllClaims } from "./api.js";
  import ClaimCard from "./ClaimCard.svelte";
  import { t } from "./i18n.svelte.js";
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
      <h2 title={t("claims_board.pending.hint")}>
        {t("claims_board.pending")}
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
      <h2 title={t("claims_board.in_progress.hint")}>{t("claims_board.in_progress")}</h2>
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
      <h2>{t("claims_board.expired")}</h2>
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
      <h2>{t("claims_board.archived")}</h2>
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
    background: var(--warning-bg);
    color: var(--warning);
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
    min-height: calc(100dvh - 60px);
    /* Four 240px columns have a hard floor; below it the grid scrolls
       sideways rather than crushing the cards (DESIGN.md, canvas rule). */
    overflow-x: auto;
  }
  .column {
    background: var(--border-subtle);
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
    color: var(--text-secondary);
  }
  .count {
    background: var(--border-strong);
    color: var(--text-body);
    font-size: 11px;
    padding: 1px 7px;
    border-radius: 999px;
  }
  .cards {
    flex: 1;
    min-height: 60px;
  }
  .cards.scrollable {
    max-height: calc(100vh - 130px);
    max-height: calc(100dvh - 130px);
    overflow-y: auto;
  }
  .empty {
    padding: 16px 0;
    text-align: center;
    color: var(--text-muted);
    font-size: 13px;
  }
</style>
