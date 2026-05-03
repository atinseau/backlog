<script lang="ts">
  import { onDestroy } from "svelte";
  import { apiUrl } from "./api.js";
  import { t } from "./i18n.svelte.js";
  import type { BoardResponse, RunSummary, SubTaskCard } from "./types.js";

  interface Props {
    board: BoardResponse | null;
    projectId: string | null;
    onOpenActivity?: () => void;
    variant?: "standalone" | "inline";
  }

  let { board, projectId, onOpenActivity, variant = "standalone" }: Props = $props();

  type ActivityEvent = {
    ts: string;
    runId?: string;
    type: string;
    message?: string;
  };

  let latest = $state<ActivityEvent | null>(null);
  let source: EventSource | null = null;
  let lastProjectId: string | null | undefined = undefined;

  function allSubtasks(): SubTaskCard[] {
    if (!board) return [];
    return Object.values(board.columns).flatMap((cards) => cards.flatMap((card) => card.tasks));
  }

  const active = $derived(allSubtasks().filter((task) => {
    const status = task.active_run?.status;
    return status === "queued" || status === "preparing" || status === "running";
  }));

  const review = $derived(allSubtasks().filter((task) =>
    task.active_run?.status === "awaiting_review" || task.status === "review",
  ));

  const blocked = $derived(allSubtasks().filter((task) => task.status === "blocked"));

  function runLabel(run: RunSummary | null | undefined): string {
    if (!run) return "";
    const mode = run.execution_mode === "direct"
      ? t("run_status.mode.direct")
      : t("run_status.mode.worktree");
    return `${run.id} · ${run.agent_id} · ${mode}`;
  }

  function activeRunLabel(run: RunSummary): string {
    const labels: Record<string, string> = {
      queued: t("run_status.queued"),
      preparing: t("run_status.preparing"),
      running: t("run_status.running"),
    };
    return labels[run.status] ?? run.status;
  }

  const headline = $derived.by(() => {
    const current = active[0];
    if (current?.active_run) return activeRunLabel(current.active_run);
    if (review.length > 0) return t("run_status.review_count", { count: review.length });
    if (blocked.length > 0) return t(blocked.length > 1 ? "run_status.blocked_count_many" : "run_status.blocked_count_one", { count: blocked.length });
    return t("run_status.ready");
  });

  const detail = $derived.by(() => {
    const current = active[0];
    if (current?.active_run && latest?.runId === current.active_run.id) {
      return latest.message ? `${latest.type} · ${latest.message}` : latest.type;
    }
    if (current?.active_run) return `${current.title} · ${runLabel(current.active_run)}`;
    const failed = blocked.find((task) => task.latest_run?.result);
    if (failed?.latest_run?.result) return `${failed.latest_run.id} · ${failed.latest_run.result}`;
    if (review.length > 0) return t("run_status.review_required");
    return latest?.message ?? t("run_status.idle");
  });

  const tone = $derived(active.length > 0 ? "active" : blocked.length > 0 ? "blocked" : review.length > 0 ? "review" : "idle");

  function attach() {
    source?.close();
    source = new EventSource(apiUrl("/activity/stream"));
    source.addEventListener("activity", (raw) => {
      try {
        const data = JSON.parse((raw as MessageEvent).data) as Record<string, unknown>;
        latest = {
          ts: typeof data.ts === "string" ? data.ts : new Date().toISOString(),
          runId: typeof data.run_id === "string" ? data.run_id : undefined,
          type: typeof data.type === "string" ? data.type : "activity",
          message: typeof data.message === "string" ? data.message : undefined,
        };
      } catch {
        // Ignore malformed activity events.
      }
    });
  }

  $effect(() => {
    const id = projectId;
    if (id === lastProjectId) return;
    lastProjectId = id;
    latest = null;
    if (!id) {
      source?.close();
      source = null;
      return;
    }
    attach();
  });

  onDestroy(() => {
    source?.close();
  });
</script>

<button
  class="run-status run-status-{tone}"
  class:inline={variant === "inline"}
  onclick={() => onOpenActivity?.()}
  title={detail}
>
  <span class="pulse" aria-hidden="true"></span>
  <span class="text">
    <span class="headline">{headline}</span>
    <span class="detail">{detail}</span>
  </span>
</button>

<style>
  .run-status {
    width: min(460px, 42vw);
    min-width: 220px;
    height: 34px;
    display: grid;
    grid-template-columns: 8px minmax(0, 1fr);
    align-items: center;
    gap: 8px;
    padding: 4px 12px;
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    background: var(--bg-elevated);
    color: var(--text-primary);
    cursor: pointer;
    font: inherit;
    text-align: left;
  }
  .run-status:hover {
    border-color: var(--accent);
  }
  .run-status.inline {
    width: auto;
    min-width: 130px;
    height: 100%;
    border: none;
    border-radius: 0;
    background: transparent;
    padding: 0;
    flex: 1 1 auto;
  }
  .run-status.inline:hover {
    border-color: transparent;
    color: var(--accent-text);
  }
  .pulse {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--text-subtle);
  }
  .run-status-active .pulse {
    background: var(--success);
    box-shadow: 0 0 0 3px var(--success-bg);
  }
  .run-status-review .pulse {
    background: #a78bfa;
    box-shadow: 0 0 0 3px rgba(167, 139, 250, 0.18);
  }
  .run-status-blocked .pulse {
    background: var(--warning);
    box-shadow: 0 0 0 3px var(--warning-bg);
  }
  .text {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .headline,
  .detail {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .headline {
    font-size: 12px;
    font-weight: 700;
    color: var(--text-primary);
  }
  .run-status.inline .headline {
    font-size: 13px;
  }
  .detail {
    font-size: 10px;
    color: var(--text-muted);
  }

  @media (max-width: 980px) {
    .run-status {
      width: min(330px, 34vw);
      min-width: 160px;
    }
  }
</style>
