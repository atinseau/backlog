<script lang="ts">
  import { fetchGitFileDiff, type GitFileDiff } from "./api.js";
  import { t } from "./i18n.svelte.js";

  interface Props {
    repo: string;
    file: string;
    sha?: string | null;
    base?: string | null;
    head?: string | null;
    onClose?: () => void;
  }

  let { repo, file, sha = null, base = null, head = null, onClose }: Props = $props();

  let diff = $state<GitFileDiff | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);

  type DiffRowKind = "add" | "del" | "ctx";
  type DiffRow = {
    kind: DiffRowKind;
    oldLine: number | null;
    newLine: number | null;
    text: string;
  };

  async function load() {
    loading = true;
    error = null;
    diff = null;
    try {
      diff = await fetchGitFileDiff(repo, file, {
        ...(sha ? { sha } : {}),
        ...(base && head ? { base, head } : {}),
      });
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }

  function parseHunkHeader(line: string): { oldLine: number; newLine: number } | null {
    const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (!match) return null;
    return { oldLine: Number(match[1]), newLine: Number(match[2]) };
  }

  function contentText(line: string): string {
    return line.slice(1) || " ";
  }

  function parseUserDiff(raw: string): DiffRow[] {
    const rows: DiffRow[] = [];
    let oldLine = 0;
    let newLine = 0;
    let inHunk = false;

    for (const line of raw.split("\n")) {
      if (line.startsWith("@@")) {
        const parsed = parseHunkHeader(line);
        if (parsed) {
          oldLine = parsed.oldLine;
          newLine = parsed.newLine;
          inHunk = true;
        }
        continue;
      }

      if (!inHunk) continue;
      if (
        line.startsWith("diff --git ") ||
        line.startsWith("index ") ||
        line.startsWith("new file mode ") ||
        line.startsWith("deleted file mode ") ||
        line.startsWith("similarity index ") ||
        line.startsWith("rename from ") ||
        line.startsWith("rename to ") ||
        line.startsWith("--- ") ||
        line.startsWith("+++ ") ||
        line.startsWith("\\ No newline")
      ) {
        continue;
      }

      if (line.startsWith("+")) {
        rows.push({ kind: "add", oldLine: null, newLine, text: contentText(line) });
        newLine += 1;
      } else if (line.startsWith("-")) {
        rows.push({ kind: "del", oldLine, newLine: null, text: contentText(line) });
        oldLine += 1;
      } else {
        const text = line.startsWith(" ") ? line.slice(1) : line;
        rows.push({ kind: "ctx", oldLine, newLine, text: text || " " });
        oldLine += 1;
        newLine += 1;
      }
    }

    return rows;
  }

  const rows = $derived(diff ? parseUserDiff(diff.diff) : []);

  $effect(() => {
    repo;
    file;
    sha;
    base;
    head;
    void load();
  });
</script>

<section class="git-diff-panel">
  <header>
    <div class="title">
      <span class="repo">{repo}</span>
      {#if sha}<span class="repo">{sha.slice(0, 7)}</span>{/if}
      {#if base && head}<span class="repo">{head} vs {base.slice(0, 7)}</span>{/if}
      <code title={file}>{file}</code>
    </div>
    {#if onClose}
      <button onclick={onClose} aria-label={t("diff.close")} title={t("diff.close_hint")}>✕</button>
    {/if}
  </header>
  <div class="body">
    {#if loading}
      <div class="muted">{t("diff.loading")}</div>
    {:else if error}
      <div class="error">{error}</div>
    {:else if !diff || diff.empty}
      <div class="muted">{t("diff.empty")}</div>
    {:else if rows.length === 0}
      <div class="muted">{t("diff.empty")}</div>
    {:else}
      <div class="diff-table" role="table" aria-label={t("diff.content_label")}>
        {#each rows as row, i (i)}
          <div class="diff-row diff-row-{row.kind}" role="row">
            <span class="line-no" role="cell">{row.oldLine ?? ""}</span>
            <span class="line-no" role="cell">{row.newLine ?? ""}</span>
            <span class="content-line" role="cell">{row.text}</span>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</section>

<style>
  .git-diff-panel {
    height: 100%;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg-surface);
    color: var(--text-primary);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--border-default);
    background: var(--bg-muted);
    flex: 0 0 auto;
  }
  .title {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .repo {
    color: var(--text-muted);
    font-size: 11px;
  }
  code {
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
  }
  button {
    background: transparent;
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    padding: 2px 8px;
    color: var(--text-secondary);
    cursor: pointer;
    font: inherit;
  }
  .body {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
  }
  .muted, .error {
    padding: 16px;
    font-family: var(--font-sans, system-ui);
    font-size: 13px;
  }
  .muted { color: var(--text-muted); }
  .error { color: var(--danger); }
  .diff-table {
    padding: 12px 0;
    min-width: max-content;
    font-size: 11px;
    line-height: 1.45;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .diff-row {
    display: grid;
    grid-template-columns: 44px 44px minmax(320px, 1fr);
    min-height: 18px;
  }
  .line-no {
    padding: 0 8px;
    text-align: right;
    color: var(--text-muted);
    border-right: 1px solid var(--border-subtle);
    user-select: none;
  }
  .content-line {
    display: block;
    padding: 0 12px;
    color: var(--text-body);
    white-space: pre;
    overflow: visible;
    text-overflow: clip;
  }
  .diff-row-add { background: color-mix(in srgb, var(--success-bg) 74%, transparent); }
  .diff-row-del { background: color-mix(in srgb, var(--danger-bg) 74%, transparent); }
  .diff-row-add .content-line { color: var(--success); }
  .diff-row-del .content-line { color: var(--danger); }
</style>
