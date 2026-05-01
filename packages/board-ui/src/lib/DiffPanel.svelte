<script lang="ts">
  import { approveRun, discardRun, fetchRunDiff, type RunDiff } from "./api.js";
  import { t } from "./i18n.svelte.js";

  interface Props {
    runId: string;
    file: string;
    onClose: () => void;
    onApproved?: () => void;
  }

  let { runId, file, onClose, onApproved }: Props = $props();

  let diff = $state<RunDiff | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let approving = $state(false);
  let discarding = $state(false);

  // Resizable width persisted across launches. Default 720px, bounded
  // 360..1400 so the panel can't be dragged off-screen on small
  // displays. Drag handle sits on the left edge; pointer events run
  // on window so the gesture doesn't drop when the cursor leaves the
  // handle's 6px column.
  const WIDTH_KEY = "backlog.diff_panel.width";
  function readWidth(): number {
    if (typeof localStorage === "undefined") return 720;
    const raw = localStorage.getItem(WIDTH_KEY);
    const n = raw ? Number.parseFloat(raw) : NaN;
    if (Number.isFinite(n)) return Math.max(360, Math.min(1400, n));
    return 720;
  }
  let panelWidth = $state(readWidth());
  let resizing = $state(false);

  function startResize(event: PointerEvent) {
    event.preventDefault();
    resizing = true;
    const startX = event.clientX;
    const startWidth = panelWidth;
    function onMove(e: PointerEvent) {
      // Drag handle is on the LEFT edge of a right-anchored panel,
      // so pulling left grows the panel.
      const next = startWidth + (startX - e.clientX);
      panelWidth = Math.max(360, Math.min(1400, Math.min(window.innerWidth - 80, next)));
    }
    function onUp() {
      resizing = false;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(WIDTH_KEY, String(Math.round(panelWidth)));
      }
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  async function load() {
    loading = true;
    error = null;
    diff = null;
    try {
      diff = await fetchRunDiff(runId, file);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }

  // Run on mount + every time the file or run changes (the user might
  // click another file path in the activity banner with the panel
  // already open — that should re-fetch instead of nothing).
  $effect(() => {
    void runId;
    void file;
    void load();
  });

  // Continue / Merge button — approves the run (which triggers the
  // workspace's merge_strategy, falling through to "keep the branch +
  // tear down the worktree" when merge_strategy is "none"). Closes
  // the panel after success.
  async function handleApprove() {
    if (approving) return;
    approving = true;
    error = null;
    try {
      await approveRun(runId, { summary: "Approved from diff panel", merge_strategy: "fast_forward" });
      onApproved?.();
      onClose();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      approving = false;
    }
  }

  async function handleDiscard() {
    if (discarding) return;
    if (typeof window !== "undefined") {
      const ok = window.confirm(t("diff.discard_confirm"));
      if (!ok) return;
    }
    discarding = true;
    error = null;
    try {
      await discardRun(runId, "Discarded from diff panel");
      onApproved?.();
      onClose();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      discarding = false;
    }
  }

  function colorFor(line: string): string {
    if (line.startsWith("+++") || line.startsWith("---")) return "head";
    if (line.startsWith("@@")) return "hunk";
    if (line.startsWith("+")) return "add";
    if (line.startsWith("-")) return "del";
    return "ctx";
  }

  const hasContent = $derived(diff?.content !== undefined);
  const canApprove = $derived(Boolean(diff && !loading && !error));

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") onClose();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<aside class="panel" class:resizing aria-label={t("diff.title")} style:width="{panelWidth}px">
  <!-- 6px-wide grab handle on the left edge. Cursor changes to ew-resize
       on hover so users discover the affordance. -->
  <div
    class="resize-handle"
    role="separator"
    aria-orientation="vertical"
    aria-label={t("diff.resize")}
    onpointerdown={startResize}
  ></div>

  <header>
    <div class="title">
      <span class="prefix">📄</span>
      <code class="path">{file}</code>
    </div>
    <div class="meta">
      {#if diff && !loading}
        <code class="rev" title={hasContent ? t("diff.content_label") : t("diff.head")}>
          {hasContent ? t("diff.content_label") : diff.head}
        </code>
      {/if}
      <button class="close" onclick={onClose} aria-label={t("diff.close")} title={t("diff.close_hint")}>✕</button>
    </div>
  </header>

  <div class="body">
    {#if loading}
      <div class="muted">{t("diff.loading")}</div>
    {:else if error}
      <div class="error">{error}</div>
    {:else if diff?.content !== undefined}
      {#if diff.content_empty}
        <div class="muted">{t("diff.file_empty")}</div>
      {:else}
        <pre class="content-view">{#each diff.content.split("\n") as line, i (i)}<span class="line line-ctx">{line || "​"}{"\n"}</span>{/each}</pre>
      {/if}
    {:else if !diff || diff.empty}
      <div class="muted">{t("diff.empty")}</div>
    {:else}
      <pre>{#each diff.diff.split("\n") as line, i (i)}<span class="line line-{colorFor(line)}">{line || "​"}{"\n"}</span>{/each}</pre>
    {/if}
  </div>

  <!-- Continue / Merge footer. Hidden when there's no diff or the
       fetch is still loading; otherwise the button lets the user
       approve the run inline. The actual merge / cleanup follows
       the workspace's git.merge_strategy. -->
  {#if canApprove}
    <footer>
      <button class="primary" onclick={handleApprove} disabled={approving} title={t("diff.continue_hint")}>
        {approving ? t("diff.continue_doing") : t("diff.continue")}
      </button>
      <button class="danger" onclick={handleDiscard} disabled={discarding || approving} title={t("diff.discard_hint")}>
        {discarding ? t("diff.discard_doing") : t("diff.discard")}
      </button>
    </footer>
  {/if}
</aside>

<style>
  .panel {
    position: fixed;
    top: 0;
    right: 0;
    height: 100vh;
    /* width applied inline via style:width — driven by panelWidth. */
    background: var(--bg-surface);
    border-left: 1px solid var(--border-default);
    box-shadow: -4px 0 16px rgba(0, 0, 0, 0.12);
    z-index: 60;
    display: flex;
    flex-direction: column;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .panel.resizing { user-select: none; }
  .resize-handle {
    position: absolute;
    top: 0;
    left: -3px;
    width: 6px;
    height: 100%;
    cursor: ew-resize;
    z-index: 1;
  }
  .resize-handle:hover { background: var(--accent-bg); }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border-default);
    background: var(--bg-muted);
    flex-shrink: 0;
  }
  .title { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1; }
  .prefix { font-size: 14px; }
  .path {
    font-size: 12px;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
  .rev {
    font-size: 10px;
    color: var(--text-muted);
    background: var(--bg-hover);
    padding: 2px 6px;
    border-radius: 3px;
  }
  .close {
    background: transparent;
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    padding: 2px 8px;
    cursor: pointer;
    color: var(--text-secondary);
    font-family: inherit;
    font-size: 13px;
  }
  .close:hover { background: var(--bg-hover); }

  .body {
    flex: 1;
    overflow: auto;
    background: var(--bg-muted);
  }
  .muted {
    padding: 24px;
    color: var(--text-subtle);
    font-style: italic;
    text-align: center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  }
  .error {
    padding: 12px 16px;
    background: var(--danger-bg);
    color: var(--danger);
    font-size: 12px;
    margin: 12px;
    border-radius: 4px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  }
  pre {
    margin: 0;
    padding: 8px 0;
    font-size: 12px;
    line-height: 1.5;
    white-space: pre;
    overflow-x: auto;
  }
  .line {
    display: block;
    padding: 0 12px;
    /* Each diff line gets a faint left bar via the body color so the
       eye lands on +/- areas without scanning column 0. */
  }
  .line-add { background: var(--success-bg); color: var(--success); }
  .line-del { background: var(--danger-bg); color: var(--danger); }
  .line-hunk { background: var(--accent-bg); color: var(--accent-text); }
  .line-head { color: var(--text-body); font-weight: 600; }
  .line-ctx { color: var(--text-secondary); }

  footer {
    border-top: 1px solid var(--border-default);
    background: var(--bg-muted);
    padding: 10px 14px;
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    flex-shrink: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  }
  .primary {
    background: var(--success);
    color: white;
    border: none;
    border-radius: 4px;
    padding: 7px 14px;
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }
  .primary:hover:not(:disabled) { filter: brightness(1.08); }
  .primary:disabled { opacity: 0.6; cursor: wait; }
  .danger {
    background: var(--danger-bg);
    color: var(--danger);
    border: 1px solid var(--danger);
    border-radius: 4px;
    padding: 7px 14px;
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }
  .danger:hover:not(:disabled) {
    background: var(--danger);
    color: var(--text-inverse);
  }
  .danger:disabled { opacity: 0.6; cursor: wait; }
</style>
