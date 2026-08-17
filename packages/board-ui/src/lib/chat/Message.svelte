<script lang="ts">
  import ConfirmationCard from "./ConfirmationCard.svelte";
  import Icon from "./Icon.svelte";
  import ToolTrace from "./ToolTrace.svelte";
  import { renderMarkdown } from "../markdown.js";
  import { t } from "../i18n.svelte.js";
  import type { ChatTranscriptMessage } from "../types.js";

  interface Props {
    message: ChatTranscriptMessage;
    streaming?: boolean;
    busy?: boolean;
    /** Absent when the message cannot be rewound to — a streaming turn. */
    onedit?: ((content: string) => void) | undefined;
    onregenerate?: (() => void) | undefined;
    onconfirm: () => void;
    oncancel: () => void;
  }

  let {
    message,
    streaming = false,
    busy = false,
    onedit,
    onregenerate,
    onconfirm,
    oncancel,
  }: Props = $props();

  let copied = $state(false);
  let editing = $state(false);
  let draft = $state("");

  function startEditing() {
    draft = message.content;
    editing = true;
  }

  function commitEdit() {
    const text = draft.trim();
    editing = false;
    if (text && text !== message.content) onedit?.(text);
  }

  function editKeydown(event: KeyboardEvent) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      commitEdit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      editing = false;
    }
  }
  const pending = $derived(
    message.tool_calls.find((call) => call.status === "awaiting_confirmation") ?? null,
  );
  const html = $derived(renderMarkdown(message.content));

  async function copy() {
    try {
      await navigator.clipboard.writeText(message.content);
      copied = true;
      setTimeout(() => (copied = false), 1400);
    } catch {
      // Clipboard denied — the text is still selectable.
    }
  }

  function tokens(): string {
    const usage = message.usage;
    if (!usage) return "";
    const total = usage.input_tokens + usage.output_tokens;
    const cached = usage.cache_read_input_tokens;
    return cached > 0 ? `${total} + ${cached} ${t("chat.cached")}` : String(total);
  }
</script>

<article class="message" class:user={message.role === "user"}>
  {#if message.role === "user"}
    {#if editing}
      <div class="editor">
        <textarea
          bind:value={draft}
          onkeydown={editKeydown}
          rows="3"
          aria-label={t("chat.edit")}
        ></textarea>
        <div class="editor-actions">
          <button type="button" class="primary" onclick={commitEdit}>{t("chat.edit_resend")}</button>
          <button type="button" onclick={() => (editing = false)}>{t("chat.edit_cancel")}</button>
        </div>
      </div>
    {:else}
      <p class="said">{message.content}</p>
      {#if onedit}
        <footer>
          <button type="button" onclick={startEditing} disabled={busy} title={t("chat.edit")}>
            <Icon name="edit" size={11} />
            <span>{t("chat.edit")}</span>
          </button>
        </footer>
      {/if}
    {/if}
  {:else}
    <ToolTrace calls={message.tool_calls} />

    {#if html}
      <div class="prose">{@html html}</div>
    {:else if streaming && !pending}
      <p class="waiting">{t("chat.thinking")}</p>
    {/if}

    {#if pending}
      <ConfirmationCard call={pending} disabled={busy} {onconfirm} {oncancel} />
    {/if}

    {#if message.error}
      <p class="failed">{message.error}</p>
    {/if}

    {#if !streaming && message.content}
      <footer>
        <button type="button" onclick={copy} title={t("chat.copy")}>
          <Icon name={copied ? "check" : "copy"} size={11} />
          <span>{copied ? t("chat.copied") : t("chat.copy")}</span>
        </button>
        {#if onregenerate}
          <button type="button" onclick={onregenerate} disabled={busy} title={t("chat.regenerate")}>
            <Icon name="history" size={11} />
            <span>{t("chat.regenerate")}</span>
          </button>
        {/if}
        {#if message.usage}
          <span class="cost" title={t("chat.usage_hint")}>
            {tokens()}
            {#if message.usage.cost_usd}· ${message.usage.cost_usd.toFixed(3)}{/if}
          </span>
        {/if}
      </footer>
    {/if}
  {/if}
</article>

<style>
  /* No bubbles, no avatars. The two voices are told apart by indentation and
     ink weight, the way a diff tells apart two sides — this is an operator
     surface, not a messaging app. */
  .message {
    padding: 10px 0;
    border-bottom: 1px solid var(--border-subtle);
  }

  .message:last-child {
    border-bottom: none;
  }

  .said {
    margin: 0;
    padding-left: 10px;
    border-left: 2px solid var(--border-strong);
    color: var(--text-strong);
    font-size: 13px;
    line-height: 1.45;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .prose {
    color: var(--text-body);
    font-size: 13px;
    line-height: 1.5;
    overflow-wrap: anywhere;
  }

  .waiting {
    margin: 0;
    color: var(--text-muted);
    font-size: 12px;
  }

  .failed {
    margin: 6px 0 0 0;
    padding: 6px 8px;
    border-radius: 4px;
    background: var(--danger-bg);
    color: var(--danger);
    font-size: 12px;
  }

  /* Controls stay latent: they appear on hover or keyboard focus, so a quiet
     transcript reads as text rather than as a row of buttons. */
  footer {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 6px;
    opacity: 0;
    transition: opacity 100ms ease;
  }

  .message:hover footer,
  .message:focus-within footer {
    opacity: 1;
  }

  footer button {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2px 4px;
    border: none;
    border-radius: 3px;
    background: transparent;
    color: var(--text-muted);
    font-size: 11px;
    cursor: pointer;
  }

  footer button:hover {
    background: var(--bg-hover);
    color: var(--text-body);
  }

  footer button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
    opacity: 1;
  }

  .cost {
    margin-left: auto;
    color: var(--text-muted);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 10px;
  }

  /* Markdown output. Scoped through :global because the HTML is injected. */
  .prose :global(p) {
    margin: 0 0 8px 0;
  }

  .prose :global(p:last-child) {
    margin-bottom: 0;
  }

  .prose :global(h1),
  .prose :global(h2),
  .prose :global(h3) {
    margin: 12px 0 4px 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-strong);
  }

  .prose :global(ul),
  .prose :global(ol) {
    margin: 0 0 8px 0;
    padding-left: 18px;
  }

  .prose :global(li) {
    margin: 2px 0;
  }

  .prose :global(code) {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12px;
    padding: 1px 4px;
    border-radius: 3px;
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  /* A code block is machine output: it keeps the console's dark ground in both
     themes, like every other machine surface in the product. */
  .prose :global(pre) {
    margin: 8px 0;
    padding: 8px 10px;
    border-radius: 4px;
    background: var(--console-bg);
    overflow-x: auto;
  }

  .prose :global(pre code) {
    padding: 0;
    background: none;
    color: var(--console-text);
    font-size: 12px;
    line-height: 1.5;
  }

  .prose :global(a) {
    color: var(--accent-text);
    text-underline-offset: 2px;
  }

  .prose :global(strong) {
    color: var(--text-strong);
    font-weight: 600;
  }

  /* Editing keeps the message where it is rather than opening a dialog: the
     surrounding turns are the context you are editing against. */
  .editor {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .editor textarea {
    width: 100%;
    padding: 7px 8px;
    border: 1px solid var(--accent);
    border-radius: 4px;
    background: var(--bg-input);
    color: var(--text-primary);
    font-family: inherit;
    font-size: 13px;
    line-height: 1.45;
    resize: vertical;
  }

  .editor textarea:focus {
    outline: 2px solid var(--accent);
    outline-offset: -1px;
  }

  .editor-actions {
    display: flex;
    gap: 6px;
  }

  .editor-actions button {
    padding: 4px 10px;
    border: 1px solid var(--border-field);
    border-radius: 4px;
    background: transparent;
    color: var(--text-body);
    font-size: 12px;
    cursor: pointer;
  }

  .editor-actions .primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-on);
    font-weight: 600;
  }

  .editor-actions button:hover {
    filter: brightness(0.96);
  }
</style>
