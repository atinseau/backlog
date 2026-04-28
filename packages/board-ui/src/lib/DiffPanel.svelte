<script lang="ts">
  import { fetchRunDiff, type RunDiff } from "./api.js";
  import { t } from "./i18n.svelte.js";

  interface Props {
    runId: string;
    file: string;
    onClose: () => void;
  }

  let { runId, file, onClose }: Props = $props();

  let diff = $state<RunDiff | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);

  async function load() {
    loading = true;
    error = null;
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

  function colorFor(line: string): string {
    if (line.startsWith("+++") || line.startsWith("---")) return "head";
    if (line.startsWith("@@")) return "hunk";
    if (line.startsWith("+")) return "add";
    if (line.startsWith("-")) return "del";
    return "ctx";
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") onClose();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<aside class="panel" aria-label={t("diff.title")}>
  <header>
    <div class="title">
      <span class="prefix">📄</span>
      <code class="path">{file}</code>
    </div>
    <div class="meta">
      {#if diff && !loading}
        <code class="rev" title={t("diff.head")}>{diff.head}</code>
      {/if}
      <button class="close" onclick={onClose} aria-label={t("diff.close")} title={t("diff.close_hint")}>✕</button>
    </div>
  </header>

  <div class="body">
    {#if loading}
      <div class="muted">{t("diff.loading")}</div>
    {:else if error}
      <div class="error">{error}</div>
    {:else if !diff || diff.empty}
      <div class="muted">{t("diff.empty")}</div>
    {:else}
      <pre>{#each diff.diff.split("\n") as line, i (i)}<span class="line line-{colorFor(line)}">{line || "​"}{"\n"}</span>{/each}</pre>
    {/if}
  </div>
</aside>

<style>
  .panel {
    position: fixed;
    top: 0;
    right: 0;
    height: 100vh;
    width: min(720px, 95vw);
    background: white;
    border-left: 1px solid #e4e7ec;
    box-shadow: -4px 0 16px rgba(0, 0, 0, 0.12);
    z-index: 60;
    display: flex;
    flex-direction: column;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 14px;
    border-bottom: 1px solid #e4e7ec;
    background: #f9fafb;
    flex-shrink: 0;
  }
  .title { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1; }
  .prefix { font-size: 14px; }
  .path {
    font-size: 12px;
    color: #1d2939;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
  .rev {
    font-size: 10px;
    color: #667085;
    background: #eaecf0;
    padding: 2px 6px;
    border-radius: 3px;
  }
  .close {
    background: transparent;
    border: 1px solid #d0d5dd;
    border-radius: 4px;
    padding: 2px 8px;
    cursor: pointer;
    color: #475467;
    font-family: inherit;
    font-size: 13px;
  }
  .close:hover { background: #f2f4f7; }

  .body {
    flex: 1;
    overflow: auto;
    background: #fafbfc;
  }
  .muted {
    padding: 24px;
    color: #98a2b3;
    font-style: italic;
    text-align: center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  }
  .error {
    padding: 12px 16px;
    background: #fee4e2;
    color: #b42318;
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
  .line-add { background: #ecfdf3; color: #027a48; }
  .line-del { background: #fee4e2; color: #b42318; }
  .line-hunk { background: #eff8ff; color: #175cd3; }
  .line-head { color: #344054; font-weight: 600; }
  .line-ctx { color: #475467; }
</style>
