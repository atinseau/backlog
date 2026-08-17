<script lang="ts">
  import { onDestroy } from "svelte";
  import {
    archiveClaim,
    fetchAllClaims,
    fetchCommits,
    fetchGitCommitFiles,
    fetchRuns,
    type CommitEntry,
    type EnrichedRun,
    type GitCommitFileEntry,
  } from "./api.js";
  import { formatAgentLabel } from "./agent-label.js";
  import { t } from "./i18n.svelte.js";
  import { formatDuration, formatRemaining, useTimer } from "./timer.svelte.js";
  import type { ClaimRecord } from "./types.js";

  interface Props {
    onClose: () => void;
    embedded?: boolean;
    repoFilter?: string | null;
    refreshSignal?: number;
    onChanged?: () => void;
    onOpenDiff?: (repo: string, file: string, sha?: string | null, base?: string | null, head?: string | null) => void;
  }

  type ClaimTab = "index" | "timeline";
  type CommitSource = "history" | "run";

  interface RelatedCommit extends CommitEntry {
    sources: CommitSource[];
    run_ids: string[];
    inferred: boolean;
  }

  interface ClaimRow {
    claim: ClaimRecord;
    runs: EnrichedRun[];
    commits: RelatedCommit[];
    files: GitCommitFileEntry[];
    active: boolean;
    expired: boolean;
    startMs: number;
    endMs: number;
  }

  const MAX_COMMITS = 200;
  const MAX_COMMIT_FILE_FETCHES = 80;

  let {
    onClose,
    embedded = false,
    repoFilter = null,
    refreshSignal = 0,
    onChanged,
    onOpenDiff,
  }: Props = $props();

  const timer = useTimer();
  onDestroy(() => {
    loadSeq += 1;
    timer.release();
  });

  let activeTab = $state<ClaimTab>("index");
  let activeClaims = $state<ClaimRecord[]>([]);
  let archivedClaims = $state<ClaimRecord[]>([]);
  let runs = $state<EnrichedRun[]>([]);
  let commits = $state<CommitEntry[]>([]);
  let commitFilesByKey = $state<Record<string, GitCommitFileEntry[]>>({});
  let commitFileErrors = $state<Record<string, string>>({});
  let loading = $state(true);
  let filesLoading = $state(false);
  let busyAction = $state<string | null>(null);
  let error = $state<string | null>(null);
  let loadSeq = 0;

  const historyByKey = $derived.by(() => buildHistoryMap(commits));
  const allClaims = $derived.by(() =>
    [...activeClaims, ...archivedClaims].sort((a, b) => {
      if (a.status !== b.status) return a.status === "active" ? -1 : 1;
      return claimSortTime(b) - claimSortTime(a);
    }),
  );
  const claimRows = $derived.by<ClaimRow[]>(() =>
    allClaims.map((claim) => {
      const relatedRuns = runsForClaim(claim.id);
      const relatedCommits = relatedCommitsForClaim(claim, relatedRuns, commits, historyByKey);
      const files = uniqueFiles(relatedCommits.flatMap((commit) => filesForCommit(commit)));
      return {
        claim,
        runs: relatedRuns,
        commits: relatedCommits,
        files,
        active: claim.status === "active",
        expired: claimExpired(claim),
        startMs: claimStartMs(claim),
        endMs: claimEndMs(claim),
      };
    }),
  );
  const activeCount = $derived(activeClaims.length);
  const archivedCount = $derived(archivedClaims.length);
  const commitCount = $derived(new Set(claimRows.flatMap((row) => row.commits.map((commit) => commitKey(commit)))).size);
  const fileCount = $derived(new Set(claimRows.flatMap((row) => row.files.map((file) => file.path))).size);
  const timelineRange = $derived.by(() => {
    const times: number[] = [];
    for (const row of claimRows) {
      if (Number.isFinite(row.startMs)) times.push(row.startMs);
      if (Number.isFinite(row.endMs)) times.push(row.endMs);
      for (const commit of row.commits) {
        const ms = Date.parse(commit.date);
        if (Number.isFinite(ms)) times.push(ms);
      }
    }
    if (times.length === 0) {
      const now = timer.now;
      return { start: now - 60 * 60_000, end: now + 10 * 60_000 };
    }
    const min = Math.min(...times);
    const max = Math.max(...times, timer.now);
    const span = Math.max(10 * 60_000, max - min);
    const pad = Math.max(5 * 60_000, span * 0.08);
    return { start: min - pad, end: max + pad };
  });
  const timelineTicks = $derived.by(() => {
    const ticks: number[] = [];
    const total = timelineRange.end - timelineRange.start;
    const steps = 6;
    for (let i = 0; i <= steps; i += 1) {
      ticks.push(timelineRange.start + (total * i) / steps);
    }
    return ticks;
  });

  $effect(() => {
    void repoFilter;
    void refreshSignal;
    void load();
  });

  function buildHistoryMap(source: CommitEntry[]): Map<string, CommitEntry> {
    return new Map(source.map((commit) => [commitKey(commit), commit]));
  }

  async function load() {
    const seq = ++loadSeq;
    loading = true;
    filesLoading = false;
    error = null;
    const opts: { repo?: string } = {};
    if (repoFilter) opts.repo = repoFilter;
    try {
      const [nextActive, nextArchived, nextRuns, nextCommits] = await Promise.all([
        fetchAllClaims(opts),
        fetchAllClaims({ ...opts, archived: true }),
        fetchRuns({ scope: "all" }),
        fetchCommits(MAX_COMMITS, repoFilter),
      ]);
      if (seq !== loadSeq) return;
      activeClaims = nextActive;
      archivedClaims = nextArchived;
      runs = repoFilter ? nextRuns.filter((run) => run.repo === repoFilter || run.claims.some((claim) => claim.repo === repoFilter)) : nextRuns;
      commits = nextCommits;
      await loadCommitFilesFor(nextActive, nextArchived, runs, nextCommits, seq);
    } catch (err) {
      if (seq === loadSeq) error = err instanceof Error ? err.message : String(err);
    } finally {
      if (seq === loadSeq) loading = false;
    }
  }

  async function loadCommitFilesFor(
    active: ClaimRecord[],
    archived: ClaimRecord[],
    sourceRuns: EnrichedRun[],
    sourceCommits: CommitEntry[],
    seq: number,
  ) {
    const history = buildHistoryMap(sourceCommits);
    const unique = new Map<string, RelatedCommit>();
    for (const claim of [...active, ...archived]) {
      const relatedRuns = sourceRuns.filter((run) => runClaimIds(run).includes(claim.id));
      for (const commit of relatedCommitsForClaim(claim, relatedRuns, sourceCommits, history)) {
        unique.set(commitKey(commit), commit);
      }
    }
    const toFetch = [...unique.values()]
      .filter((commit) => commit.sha.length >= 7)
      .slice(0, MAX_COMMIT_FILE_FETCHES);
    commitFilesByKey = {};
    commitFileErrors = {};
    if (toFetch.length === 0) return;
    filesLoading = true;
    const results = await Promise.allSettled(toFetch.map((commit) => fetchGitCommitFiles(commit.repo, commit.sha)));
    if (seq !== loadSeq) return;
    const nextFiles: Record<string, GitCommitFileEntry[]> = {};
    const nextErrors: Record<string, string> = {};
    for (let i = 0; i < toFetch.length; i += 1) {
      const commit = toFetch[i];
      const result = results[i];
      if (!commit || !result) continue;
      const key = commitKey(commit);
      if (result.status === "fulfilled") {
        nextFiles[key] = result.value.files;
      } else {
        nextErrors[key] = result.reason instanceof Error ? result.reason.message : String(result.reason);
      }
    }
    commitFilesByKey = nextFiles;
    commitFileErrors = nextErrors;
    filesLoading = false;
  }

  function commitKey(commit: Pick<CommitEntry, "repo" | "sha">): string {
    return `${commit.repo}:${commit.sha}`;
  }

  function runsForClaim(claimId: string): EnrichedRun[] {
    return runs
      .filter((run) => runClaimIds(run).includes(claimId))
      .sort((a, b) => runSortTime(b) - runSortTime(a));
  }

  function runClaimIds(run: EnrichedRun): string[] {
    return [...new Set([...run.claim_ids, ...run.claims.map((claim) => claim.id)])];
  }

  function outputCommitShas(run: EnrichedRun): string[] {
    const seen = new Set<string>();
    const shas = run.artifacts
      .filter((artifact) => artifact.kind === "commit")
      .map((artifact) => artifact.value.trim())
      .filter((value) => {
        if (!value || seen.has(value)) return false;
        seen.add(value);
        return true;
      });
    return shas.length > 1 ? shas.slice(1) : shas;
  }

  function relatedCommitsForClaim(
    claim: ClaimRecord,
    claimRuns: EnrichedRun[],
    sourceCommits: CommitEntry[],
    history: Map<string, CommitEntry>,
  ): RelatedCommit[] {
    const byKey = new Map<string, RelatedCommit>();

    for (const commit of sourceCommits) {
      if (!commit.links.some((link) => link.kind === "claim" && link.id === claim.id)) continue;
      upsertRelatedCommit(byKey, commit, "history", null, false);
    }

    for (const run of claimRuns) {
      for (const sha of outputCommitShas(run)) {
        const key = `${run.repo}:${sha}`;
        const found = history.get(key);
        const commit: CommitEntry = found ?? {
          repo: run.repo,
          sha,
          short_sha: sha.slice(0, 7),
          subject: `Run artifact ${run.id}`,
          author: run.agent_id,
          date: run.finished_at ?? run.started_at ?? claim.heartbeat_at ?? claim.created_at,
          links: [{ kind: "claim", id: claim.id }],
        };
        upsertRelatedCommit(byKey, commit, "run", run.id, !found);
      }
    }

    return [...byKey.values()].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  }

  function upsertRelatedCommit(
    byKey: Map<string, RelatedCommit>,
    commit: CommitEntry,
    source: CommitSource,
    runId: string | null,
    inferred: boolean,
  ) {
    const key = commitKey(commit);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        ...commit,
        sources: [source],
        run_ids: runId ? [runId] : [],
        inferred,
      });
      return;
    }
    if (!existing.sources.includes(source)) existing.sources = [...existing.sources, source];
    if (runId && !existing.run_ids.includes(runId)) existing.run_ids = [...existing.run_ids, runId];
    existing.inferred = existing.inferred && inferred;
  }

  function filesForCommit(commit: Pick<CommitEntry, "repo" | "sha">): GitCommitFileEntry[] {
    return commitFilesByKey[commitKey(commit)] ?? [];
  }

  function uniqueFiles(files: GitCommitFileEntry[]): GitCommitFileEntry[] {
    const byPath = new Map<string, GitCommitFileEntry>();
    for (const file of files) {
      byPath.set(`${file.old_path ?? ""}:${file.path}`, file);
    }
    return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
  }

  function claimSortTime(claim: ClaimRecord): number {
    return Date.parse(claim.finished_at ?? claim.heartbeat_at ?? claim.created_at) || 0;
  }

  function runSortTime(run: EnrichedRun): number {
    return Date.parse(run.finished_at ?? run.started_at ?? "") || 0;
  }

  function claimStartMs(claim: ClaimRecord): number {
    const created = Date.parse(claim.created_at);
    return Number.isFinite(created) ? created : timer.now;
  }

  function claimEndMs(claim: ClaimRecord): number {
    const value = claim.status === "active"
      ? timer.now
      : Date.parse(claim.finished_at ?? claim.expires_at ?? claim.heartbeat_at ?? claim.created_at);
    return Number.isFinite(value) ? value : claimStartMs(claim);
  }

  function claimExpired(claim: ClaimRecord): boolean {
    const expiresMs = Date.parse(claim.expires_at);
    return claim.status === "active" && Number.isFinite(expiresMs) && expiresMs < timer.now;
  }

  function formatDate(value?: string | null): string {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString();
  }

  function formatShortDate(ms: number): string {
    return new Date(ms).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function ageLabel(claim: ClaimRecord): string {
    const createdMs = Date.parse(claim.created_at);
    if (!Number.isFinite(createdMs)) return "-";
    const endMs = claim.status === "active" ? timer.now : claimEndMs(claim);
    return formatDuration(Math.max(0, Math.round((endMs - createdMs) / 1000)));
  }

  function claimDuration(row: ClaimRow): string {
    return formatDuration(Math.max(0, Math.round((row.endMs - row.startMs) / 1000)));
  }

  function claimAgentLabel(claim: ClaimRecord): string {
    if (claim.agent) {
      const label = formatAgentLabel({
        display_name: null,
        provider: claim.agent.provider,
        model: claim.agent.model ?? null,
      }).withContext;
      return claim.agent.profile ? `${label} - ${claim.agent.profile}` : label;
    }
    return claim.agent_id ?? t("claims_page.unassigned");
  }

  function statusLabel(row: ClaimRow): string {
    if (row.expired) return t("claims_page.status.expired");
    return row.active ? t("claims_page.status.open") : t("claims_page.status.closed");
  }

  function statusClass(row: ClaimRow): string {
    if (row.expired) return "expired";
    return row.active ? "active" : "closed";
  }

  function runTitle(run: EnrichedRun): string {
    return run.subtask?.title || run.task?.title || run.target_id || run.subtask_id || run.id;
  }

  const RUN_STATUSES = new Set([
    "queued",
    "preparing",
    "running",
    "awaiting_review",
    "succeeded",
    "failed",
    "blocked",
    "interrupted",
    "canceled",
  ]);

  function runStatusLabel(status: string): string {
    return RUN_STATUSES.has(status) ? t(`card.run_status.${status}`) : status;
  }

  function eventText(event: Record<string, unknown>): string {
    const type = typeof event.type === "string" ? event.type : null;
    const message = typeof event.message === "string" ? event.message : null;
    return [type, message].filter(Boolean).join(" - ") || JSON.stringify(event);
  }

  function eventTime(event: Record<string, unknown>): string {
    return typeof event.ts === "string" ? formatDate(event.ts) : "";
  }

  function commitSourceLabel(commit: RelatedCommit): string {
    if (commit.sources.length === 2) return t("claims_page.commit_source.both");
    return commit.sources[0] === "run"
      ? t("claims_page.commit_source.run")
      : t("claims_page.commit_source.history");
  }

  function fileKindLabel(kind: GitCommitFileEntry["kind"]): string {
    const labels: Record<GitCommitFileEntry["kind"], string> = {
      added: "A",
      modified: "M",
      deleted: "D",
      renamed: "R",
    };
    return labels[kind] ?? kind;
  }

  function timelinePct(ms: number): number {
    const span = Math.max(1, timelineRange.end - timelineRange.start);
    return Math.max(0, Math.min(100, ((ms - timelineRange.start) / span) * 100));
  }

  function barStyle(row: ClaimRow): string {
    const left = timelinePct(row.startMs);
    const right = timelinePct(row.endMs);
    return `left: ${left}%; width: ${Math.max(0.75, right - left)}%;`;
  }

  function markerStyle(commit: RelatedCommit): string {
    const ms = Date.parse(commit.date);
    return `left: ${timelinePct(Number.isFinite(ms) ? ms : timelineRange.start)}%;`;
  }

  function tickStyle(ms: number): string {
    return `left: ${timelinePct(ms)}%;`;
  }

  function diagnostics(row: ClaimRow): string[] {
    const items: string[] = [];
    if (row.expired) items.push(t("claims_page.diagnostic.ttl_over"));
    if (row.active) {
      const remaining = formatRemaining(row.claim.expires_at, timer.now);
      items.push(
        remaining
          ? t("claims_page.diagnostic.ttl_left", { time: remaining })
          : t("claims_page.diagnostic.ttl_done"),
      );
    }
    if (row.claim.expected_finish_at && row.active && Date.parse(row.claim.expected_finish_at) < timer.now) {
      items.push(t("claims_page.diagnostic.eta_over"));
    }
    if (row.runs.length === 0) items.push(t("claims_page.diagnostic.no_run"));
    if (row.commits.length === 0) items.push(t("claims_page.diagnostic.no_commit"));
    return items;
  }

  async function handleArchive(claim: ClaimRecord) {
    if (!confirm(t("claims_page.confirm_finish", { topic: claim.topic }))) return;
    busyAction = claim.id;
    try {
      await archiveClaim(claim.id);
      await load();
      onChanged?.();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busyAction = null;
    }
  }
</script>

{#snippet pathsList(paths: string[], empty = t("claims_page.paths.empty"))}
  {#if paths.length > 0}
    <ul class="paths">
      {#each paths as file, index (`${file}:${index}`)}
        <li>
          {file === "." || file === "/" || file === "*" || file === "**"
            ? t("claims_page.paths.whole_repository")
            : file}
        </li>
      {/each}
    </ul>
  {:else}
    <p class="muted">{empty}</p>
  {/if}
{/snippet}

{#snippet commitFilesList(commit: RelatedCommit)}
  {@const files = filesForCommit(commit)}
  {@const fileError = commitFileErrors[commitKey(commit)]}
  {#if files.length > 0}
    <div class="file-list">
      {#each files as file, index (`${commit.sha}:${file.path}:${index}`)}
        <button
          class="file-row"
          type="button"
          onclick={() => onOpenDiff?.(commit.repo, file.path, commit.sha)}
          disabled={!onOpenDiff}
        >
          <span class="file-kind">{fileKindLabel(file.kind)}</span>
          <span class="file-path">
            {#if file.old_path}<small>{file.old_path} -> </small>{/if}{file.path}
          </span>
        </button>
      {/each}
    </div>
  {:else if fileError}
    <p class="muted">{t("claims_page.files.unavailable", { error: fileError })}</p>
  {:else if filesLoading}
    <p class="muted">{t("claims_page.files.loading")}</p>
  {:else}
    <p class="muted">{t("claims_page.files.none")}</p>
  {/if}
{/snippet}

{#snippet body()}
  <header class="claims-header">
    <div class="title-block">
      <div>
        <h2>{t("claims_page.title")}</h2>
        <p>{repoFilter ? repoFilter : t("claims_page.all_repositories")}</p>
      </div>
      <div class="tabs" role="tablist" aria-label={t("claims_page.tabs_label")}>
        <button class="tab" class:active={activeTab === "index"} onclick={() => (activeTab = "index")}>
          {t("claims_page.tab.index")}
        </button>
        <button class="tab" class:active={activeTab === "timeline"} onclick={() => (activeTab = "timeline")}>
          {t("claims_page.tab.timeline")}
        </button>
      </div>
    </div>
    <div class="header-actions">
      <button class="refresh" onclick={load}>{t("claims_page.refresh")}</button>
      {#if !embedded}
        <button class="close" onclick={onClose} aria-label={t("claim_dialog.close")}>x</button>
      {/if}
    </div>
  </header>

  {#if error}
    <div class="error">{error}</div>
  {/if}

  <div class="stats" aria-label={t("claims_page.summary_label")}>
    <div><span>{t("claims_page.stat.open")}</span><strong>{activeCount}</strong></div>
    <div><span>{t("claims_page.stat.closed")}</span><strong>{archivedCount}</strong></div>
    <div>
      <span>{t("claims_page.stat.linked_runs")}</span>
      <strong>{new Set(claimRows.flatMap((row) => row.runs.map((run) => run.id))).size}</strong>
    </div>
    <div><span>{t("claims_page.stat.commits")}</span><strong>{commitCount}</strong></div>
    <div><span>{t("claims_page.stat.files")}</span><strong>{fileCount}</strong></div>
  </div>

  {#if loading}
    <div class="loading">{t("claims_page.loading")}</div>
  {:else if claimRows.length === 0}
    <div class="empty">{t("claims_page.empty")}</div>
  {:else if activeTab === "index"}
    <main class="claim-index">
      {#each claimRows as row (row.claim.id)}
        <details class="claim-accordion" open={row.active}>
          <summary>
            <span class="summary-main">
              <span class="status {statusClass(row)}">{statusLabel(row)}</span>
              <strong>{row.claim.topic}</strong>
              <code>{row.claim.id}</code>
            </span>
            <span class="summary-meta">
              <span>{row.claim.repo}</span>
              <span>{t("claims_page.file_count", { count: row.claim.paths.length })}</span>
              <span>{claimDuration(row)}</span>
              <span>{t("claims_page.commit_count", { count: row.commits.length })}</span>
            </span>
          </summary>

          <div class="claim-body">
            <div class="info-grid">
              <div><span>{t("claims_page.field.repository")}</span><strong>{row.claim.repo}</strong></div>
              <div><span>{t("claims_page.field.owner")}</span><strong>{claimAgentLabel(row.claim)}</strong></div>
              <div><span>{t("claims_page.field.mode")}</span><strong>{row.claim.mode}</strong></div>
              <div><span>{t("claims_page.field.age")}</span><strong>{ageLabel(row.claim)}</strong></div>
              <div><span>{t("claims_page.field.started")}</span><strong>{formatDate(row.claim.created_at)}</strong></div>
              <div><span>{t("claims_page.field.heartbeat")}</span><strong>{formatDate(row.claim.heartbeat_at)}</strong></div>
              <div><span>{t("claims_page.field.expires")}</span><strong>{formatDate(row.claim.expires_at)}</strong></div>
              <div><span>{t("claims_page.field.finished")}</span><strong>{formatDate(row.claim.finished_at)}</strong></div>
            </div>

            <div class="diagnostics">
              {#each diagnostics(row) as item (item)}
                <span>{item}</span>
              {/each}
            </div>

            {#if row.active}
              <div class="actions">
                <button type="button" onclick={() => handleArchive(row.claim)} disabled={busyAction === row.claim.id}>
                  {t("claims_page.action.finish")}
                </button>
              </div>
            {/if}

            <section class="block">
              <h3>{t("claims_page.section.protected_files")}</h3>
              {@render pathsList(row.claim.paths)}
            </section>

            {#if row.runs.length > 0}
              <section class="block">
                <h3>{t("claims_page.section.runs_logs")}</h3>
                <div class="run-stack">
                  {#each row.runs as run (run.id)}
                    <details class="run-log">
                      <summary>
                        <span>
                          <strong>{runTitle(run)}</strong>
                          <code>{run.id}</code>
                        </span>
                        <span>{runStatusLabel(run.status)} - {formatDate(run.started_at)}</span>
                      </summary>
                      <div class="run-grid">
                        <div><span>{t("claims_page.field.agent")}</span><strong>{run.owner.display_name ?? run.agent_id}</strong></div>
                        <div><span>{t("claims_page.field.branch")}</span><code>{run.branch}</code></div>
                        <div><span>{t("claims_page.field.finished")}</span><strong>{formatDate(run.finished_at)}</strong></div>
                      </div>
                      {#if run.events.length > 0}
                        <ol class="events">
                          {#each run.events as event, index (`${run.id}:${index}`)}
                            <li>
                              <span>{eventTime(event)}</span>
                              <p>{eventText(event)}</p>
                            </li>
                          {/each}
                        </ol>
                      {:else}
                        <p class="muted">{t("claims_page.no_logs")}</p>
                      {/if}
                    </details>
                  {/each}
                </div>
              </section>
            {/if}

            <section class="block">
              <h3>{t("claims_page.section.commits")}</h3>
              {#if row.commits.length === 0}
                <p class="muted">{t("claims_page.no_commits")}</p>
              {:else}
                <div class="commit-stack">
                  {#each row.commits as commit (commitKey(commit))}
                    <details class="commit-detail">
                      <summary>
                        <span>
                          <code>{commit.short_sha}</code>
                          <strong>{commit.subject}</strong>
                        </span>
                        <span>{commitSourceLabel(commit)} - {formatDate(commit.date)}</span>
                      </summary>
                      {@render commitFilesList(commit)}
                    </details>
                  {/each}
                </div>
              {/if}
            </section>

            {#if row.claim.metadata && Object.keys(row.claim.metadata).length > 0}
              <section class="block">
                <h3>{t("claims_page.section.metadata")}</h3>
                <div class="chips">
                  {#each Object.entries(row.claim.metadata) as [key, value] (key)}
                    <span><strong>{key}</strong>: {value}</span>
                  {/each}
                </div>
              </section>
            {/if}

            <details class="raw">
              <summary>{t("claims_page.raw")}</summary>
              <pre>{JSON.stringify(row.claim, null, 2)}</pre>
            </details>
          </div>
        </details>
      {/each}
    </main>
  {:else}
    <main class="timeline-view">
      <div class="timeline-scroll" aria-label={t("claims_page.timeline_label")}>
        <div class="timeline-canvas">
          <div class="timeline-axis">
            <div class="axis-spacer"></div>
            <div class="axis-track">
              {#each timelineTicks as tick (tick)}
                <div class="tick" style={tickStyle(tick)}>
                  <span>{formatShortDate(tick)}</span>
                </div>
              {/each}
            </div>
          </div>

          {#each claimRows as row (row.claim.id)}
            <section class="timeline-row">
              <div class="timeline-label">
                <span class="status {statusClass(row)}">{statusLabel(row)}</span>
                <strong>{row.claim.topic}</strong>
                <code>{row.claim.id}</code>
                <small>{row.claim.repo} - {t("claims_page.file_count", { count: row.claim.paths.length })}</small>
              </div>
              <div class="timeline-track">
                {#each timelineTicks as tick (tick)}
                  <span class="grid-line" style={tickStyle(tick)}></span>
                {/each}
                <div class="claim-bar {statusClass(row)}" style={barStyle(row)}>
                  <span>{claimDuration(row)}</span>
                </div>
                {#each row.commits as commit (commitKey(commit))}
                  <button
                    type="button"
                    class="commit-marker"
                    style={markerStyle(commit)}
                    title={`${commit.short_sha} - ${commit.subject}`}
                  >
                    <span>{commit.short_sha}</span>
                  </button>
                {/each}
              </div>
              <div class="timeline-linked">
                {#if row.commits.length === 0}
                  <span class="muted">{t("claims_page.no_commits_short")}</span>
                {:else}
                  {#each row.commits as commit (commitKey(commit))}
                    <details class="timeline-commit">
                      <summary>
                        <code>{commit.short_sha}</code>
                        <span>{commit.subject}</span>
                        <small>{t("claims_page.file_count", { count: filesForCommit(commit).length })}</small>
                      </summary>
                      {@render commitFilesList(commit)}
                    </details>
                  {/each}
                {/if}
              </div>
            </section>
          {/each}
        </div>
      </div>
    </main>
  {/if}
{/snippet}

{#if embedded}
  <div class="embedded">{@render body()}</div>
{:else}
  <div class="backdrop" onclick={onClose} role="presentation">
    <div
      class="modal"
      onclick={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal="true"
      tabindex={-1}
      onkeydown={(e) => { if (e.key === "Escape") onClose(); }}
    >
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
    width: min(1180px, 94vw);
    height: min(860px, 88vh);
    height: min(860px, 88dvh);
    background: var(--bg-surface);
    color: var(--text-primary);
    border-radius: 8px;
    box-shadow: var(--shadow-modal);
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
  .claims-header {
    flex: 0 0 auto;
    padding: 14px 18px;
    border-bottom: 1px solid var(--border-default);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .title-block {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 16px;
  }
  h2, h3, p { margin: 0; }
  h2 {
    font-size: 16px;
    line-height: 1.2;
  }
  h3 {
    font-size: 13px;
  }
  .title-block p {
    margin-top: 3px;
    color: var(--text-muted);
    font-size: 12px;
  }
  .tabs {
    display: flex;
    gap: 4px;
    padding: 2px;
    border-radius: 6px;
    background: var(--bg-hover);
  }
  .tab {
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--text-secondary);
    padding: 4px 10px;
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .tab:hover {
    color: var(--text-primary);
  }
  .tab.active {
    background: var(--bg-surface);
    color: var(--text-primary);
    box-shadow: var(--elev-rest);
  }
  .header-actions {
    display: flex;
    gap: 6px;
  }
  .refresh,
  .close,
  .actions button {
    background: var(--bg-hover);
    color: var(--text-primary);
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    padding: 4px 10px;
    /* WCAG 2.5.8 floor; widens to 28px on a coarse pointer. */
    min-height: var(--tap-size);
    min-width: var(--tap-size);
    cursor: pointer;
    font-size: 12px;
  }
  .close {
    border: none;
    font-size: 16px;
    padding: 2px 8px;
  }
  .refresh:hover,
  .actions button:hover:not(:disabled) {
    background: var(--bg-active);
  }
  .refresh:focus-visible,
  .close:focus-visible,
  .actions button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .error {
    background: var(--warning-bg);
    color: var(--warning);
    padding: 8px 18px;
    font-size: 12px;
  }
  .stats {
    flex: 0 0 auto;
    display: grid;
    grid-template-columns: repeat(5, minmax(92px, 1fr));
    gap: 1px;
    border-bottom: 1px solid var(--border-default);
    background: var(--border-subtle);
  }
  .stats > div {
    background: var(--bg-surface);
    padding: 10px 14px;
    min-width: 0;
  }
  .stats span,
  .muted {
    color: var(--text-muted);
    font-size: 12px;
  }
  .stats strong {
    display: block;
    margin-top: 2px;
    font-size: 16px;
  }
  .loading,
  .empty {
    padding: 32px;
    text-align: center;
    color: var(--text-muted);
    font-size: 13px;
  }
  .claim-index {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .claim-accordion,
  .run-log,
  .commit-detail,
  .timeline-commit,
  .raw {
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
    background: var(--bg-surface);
  }
  .claim-accordion > summary,
  .run-log > summary,
  .commit-detail > summary,
  .timeline-commit > summary,
  .raw > summary {
    cursor: pointer;
    list-style: none;
  }
  .claim-accordion > summary::-webkit-details-marker,
  .run-log > summary::-webkit-details-marker,
  .commit-detail > summary::-webkit-details-marker,
  .timeline-commit > summary::-webkit-details-marker,
  .raw > summary::-webkit-details-marker {
    display: none;
  }
  .claim-accordion > summary {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 12px;
    align-items: center;
    padding: 11px 12px;
  }
  .summary-main {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .summary-main strong {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .summary-meta {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 9px;
    color: var(--text-muted);
    font-size: 12px;
  }
  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px;
    background: var(--bg-hover);
    color: var(--text-body);
    padding: 1px 4px;
    border-radius: 3px;
    word-break: break-all;
  }
  .status {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    padding: 2px 7px;
    font-size: 10px;
    letter-spacing: 0.04em;
    font-weight: 700;
    text-transform: uppercase;
    background: var(--bg-hover);
    color: var(--text-secondary);
  }
  .status.active {
    background: var(--accent-bg);
    color: var(--accent-text);
  }
  .status.closed {
    background: var(--success-bg);
    color: var(--success);
  }
  .status.expired {
    background: var(--danger-bg);
    color: var(--danger);
  }
  .claim-body {
    border-top: 1px solid var(--border-subtle);
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .info-grid,
  .run-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
    gap: 8px;
  }
  .info-grid > div,
  .run-grid > div {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 9px 10px;
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
    background: var(--bg-muted);
  }
  .info-grid span,
  .run-grid span {
    color: var(--text-muted);
    font-size: 12px;
  }
  .info-grid strong,
  .run-grid strong {
    font-size: 13px;
    overflow-wrap: anywhere;
  }
  .diagnostics,
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .diagnostics span,
  .chips span {
    border-radius: 999px;
    padding: 3px 8px;
    background: var(--bg-hover);
    color: var(--text-body);
    font-size: 11px;
  }
  .actions {
    display: flex;
    gap: 8px;
  }
  .actions button:disabled {
    opacity: 0.55;
    cursor: wait;
  }
  .block {
    border-top: 1px solid var(--border-subtle);
    padding-top: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .paths {
    list-style: none;
    margin: 0;
    padding: 7px 9px;
    border-radius: 4px;
    background: var(--bg-hover);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px;
    color: var(--text-body);
  }
  .paths li {
    padding: 2px 0;
    overflow-wrap: anywhere;
  }
  .run-stack,
  .commit-stack {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .run-log,
  .commit-detail,
  .timeline-commit {
    background: var(--bg-muted);
  }
  .run-log > summary,
  .commit-detail > summary,
  .timeline-commit > summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 9px 10px;
    color: var(--text-body);
    font-size: 12px;
  }
  .run-log > summary span,
  .commit-detail > summary span,
  .timeline-commit > summary span {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 7px;
  }
  .run-log > summary strong,
  .commit-detail > summary strong,
  .timeline-commit > summary span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .run-grid,
  .events,
  .file-list,
  .commit-detail .muted,
  .timeline-commit .muted {
    margin: 0 10px 10px;
  }
  .events {
    padding-left: 18px;
    display: flex;
    flex-direction: column;
    gap: 7px;
  }
  .events li span {
    color: var(--text-muted);
    font-size: 11px;
  }
  .events li p {
    margin-top: 2px;
    color: var(--text-body);
    font-size: 12px;
    overflow-wrap: anywhere;
  }
  .file-list {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--border-subtle);
    border-radius: 4px;
    overflow: hidden;
  }
  .file-row {
    width: 100%;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    border: none;
    border-bottom: 1px solid var(--border-subtle);
    background: var(--bg-surface);
    color: var(--text-primary);
    padding: 6px 8px;
    font: inherit;
    font-size: 12px;
    text-align: left;
    cursor: pointer;
  }
  .file-row:last-child {
    border-bottom: none;
  }
  .file-row:hover:not(:disabled) {
    background: var(--bg-hover);
  }
  .file-row:disabled {
    cursor: default;
  }
  .file-kind {
    flex: 0 0 auto;
    width: 18px;
    color: var(--text-muted);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px;
  }
  .file-path {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .file-path small {
    color: var(--text-muted);
  }
  .raw {
    padding: 10px;
  }
  .raw pre {
    margin: 8px 0 0;
    padding: 10px;
    max-height: 280px;
    overflow: auto;
    background: var(--bg-muted);
    border-radius: 6px;
    font-size: 11px;
    line-height: 1.45;
  }
  .timeline-view {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    overflow: hidden;
  }
  .timeline-scroll {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    padding: 12px;
  }
  .timeline-canvas {
    min-width: 1120px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .timeline-axis,
  .timeline-row {
    display: grid;
    grid-template-columns: 280px minmax(760px, 1fr);
    gap: 12px;
  }
  .axis-spacer {
    min-height: 34px;
  }
  .axis-track,
  .timeline-track {
    position: relative;
    min-height: 34px;
  }
  .tick {
    position: absolute;
    top: 0;
    bottom: 0;
    transform: translateX(-50%);
    border-left: 1px solid var(--border-subtle);
  }
  .tick span {
    position: absolute;
    top: 0;
    left: 6px;
    white-space: nowrap;
    color: var(--text-muted);
    font-size: 11px;
  }
  .timeline-row {
    align-items: stretch;
    padding: 10px 0;
    border-top: 1px solid var(--border-subtle);
  }
  .timeline-label {
    min-width: 0;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-content: start;
    gap: 4px 8px;
  }
  .timeline-label strong,
  .timeline-label small,
  .timeline-label code {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .timeline-label code,
  .timeline-label small {
    grid-column: 2;
  }
  .timeline-label small {
    color: var(--text-muted);
    font-size: 11px;
  }
  .timeline-track {
    min-height: 44px;
    border-radius: 6px;
    background:
      linear-gradient(to bottom, transparent 21px, var(--border-subtle) 22px, transparent 23px),
      var(--bg-muted);
    overflow: hidden;
  }
  .grid-line {
    position: absolute;
    top: 0;
    bottom: 0;
    border-left: 1px solid var(--border-subtle);
    opacity: 0.65;
  }
  .claim-bar {
    position: absolute;
    top: 14px;
    height: 16px;
    border-radius: 999px;
    min-width: 8px;
    display: flex;
    align-items: center;
    padding: 0 7px;
    /* No shared `color` here: each variant paints a different fill, so
       each carries its own paired ink (DESIGN.md, encre appariée). */
    font-size: 11px;
    font-weight: 700;
    overflow: hidden;
    white-space: nowrap;
  }
  .claim-bar.active {
    background: var(--accent);
    color: var(--accent-on);
  }
  .claim-bar.closed {
    background: var(--success);
    color: var(--success-on);
  }
  .claim-bar.expired {
    background: var(--danger);
    color: var(--danger-on);
  }
  .commit-marker {
    position: absolute;
    top: 4px;
    width: 2px;
    height: 36px;
    transform: translateX(-1px);
    border: none;
    border-radius: 3px;
    background: var(--warning);
    color: var(--text-primary);
    cursor: pointer;
  }
  .commit-marker span {
    position: absolute;
    top: -1px;
    left: 6px;
    max-width: 82px;
    overflow: hidden;
    text-overflow: ellipsis;
    padding: 1px 4px;
    border-radius: 3px;
    background: var(--warning-bg);
    color: var(--warning);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px;
    white-space: nowrap;
  }
  .timeline-linked {
    grid-column: 2;
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
  }
  .timeline-commit > summary small {
    flex: 0 0 auto;
    color: var(--text-muted);
    font-size: 11px;
  }
  /* Width thresholds: 640 / 900 / 1280 only — see src/lib/shell/breakpoints.ts */
  @media (max-width: 900px) {
    .claims-header,
    .title-block {
      align-items: flex-start;
      flex-direction: column;
    }
    .stats {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .claim-accordion > summary {
      grid-template-columns: minmax(0, 1fr);
    }
    .summary-meta {
      justify-content: flex-start;
    }
    /* The timeline keeps a hard floor and keeps scrolling inside
       .timeline-scroll — horizontal scroll is the allowed degradation.
       What changes in a narrow window is the label gutter: it becomes
       elastic (140…280px) so the floor drops from 1120px to the width
       the track itself needs, instead of paying 280px for topic labels
       that are ellipsed anyway. */
    .timeline-canvas {
      min-width: 912px;
    }
    .timeline-axis,
    .timeline-row {
      grid-template-columns: minmax(140px, 280px) minmax(760px, 1fr);
    }
  }
</style>
