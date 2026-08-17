<script lang="ts">
  import Icon from "./Icon.svelte";
  import { t } from "../i18n.svelte.js";
  import type { ConversationSummary } from "../types.js";

  interface Props {
    conversations: ConversationSummary[];
    currentId: string | null;
    onopen: (id: string) => void;
    ondelete: (id: string) => void;
    onclose: () => void;
  }

  let { conversations, currentId, onopen, ondelete, onclose }: Props = $props();

  function when(iso: string): string {
    const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (minutes < 1) return t("chat.just_now");
    if (minutes < 60) return t("chat.minutes_ago", { n: String(minutes) });
    const hours = Math.round(minutes / 60);
    if (hours < 24) return t("chat.hours_ago", { n: String(hours) });
    return t("chat.days_ago", { n: String(Math.round(hours / 24)) });
  }
</script>

<div class="panel">
  <header>
    <h3>{t("chat.history_title")}</h3>
    <button type="button" onclick={onclose} title={t("chat.history_close")}>
      <Icon name="close" size={12} />
    </button>
  </header>

  {#if conversations.length === 0}
    <p class="empty">{t("chat.history_empty")}</p>
  {:else}
    <ul>
      {#each conversations as conversation (conversation.id)}
        <li class:active={conversation.id === currentId}>
          <button type="button" class="open" onclick={() => onopen(conversation.id)}>
            <span class="name">{conversation.title ?? t("chat.untitled")}</span>
            <span class="meta">
              {when(conversation.updated_at)} · {conversation.message_count}
            </span>
          </button>
          <button
            type="button"
            class="remove"
            onclick={() => ondelete(conversation.id)}
            title={t("chat.history_delete")}
          >
            <Icon name="trash" size={12} />
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  /* An overlay rather than a second column: the drawer is 380px wide and often
     narrower, and a permanent sidebar would eat the conversation itself. */
  .panel {
    position: absolute;
    inset: 0;
    z-index: 2;
    display: flex;
    flex-direction: column;
    background: var(--bg-surface);
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    border-bottom: 1px solid var(--border-default);
    flex-shrink: 0;
  }

  h3 {
    margin: 0;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-muted);
  }

  header button {
    display: flex;
    padding: 4px;
    border: none;
    border-radius: 3px;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    min-width: var(--tap-size);
    min-height: var(--tap-size);
    align-items: center;
    justify-content: center;
  }

  header button:hover {
    background: var(--bg-hover);
    color: var(--text-body);
  }

  .empty {
    margin: 0;
    padding: 16px 12px;
    color: var(--text-muted);
    font-size: 12px;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 4px;
    overflow-y: auto;
    flex: 1;
  }

  li {
    display: flex;
    align-items: stretch;
    border-radius: 4px;
  }

  li:hover {
    background: var(--bg-hover);
  }

  li.active {
    background: var(--accent-bg);
  }

  .open {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 6px 8px;
    border: none;
    background: transparent;
    text-align: left;
    cursor: pointer;
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
    color: var(--text-body);
  }

  li.active .name {
    color: var(--accent-text);
    font-weight: 600;
  }

  .meta {
    font-size: 10px;
    color: var(--text-muted);
  }

  /* Deleting is destructive, so it stays hidden until the row is engaged. */
  .remove {
    display: flex;
    align-items: center;
    padding: 0 8px;
    border: none;
    background: transparent;
    color: var(--text-subtle);
    cursor: pointer;
    opacity: 0;
    transition: opacity 100ms ease;
  }

  li:hover .remove,
  li:focus-within .remove {
    opacity: 1;
  }

  .remove:hover {
    color: var(--danger);
  }

  button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
</style>
