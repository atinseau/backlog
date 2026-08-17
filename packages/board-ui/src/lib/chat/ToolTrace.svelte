<script lang="ts">
  import Icon from "./Icon.svelte";
  import { t } from "../i18n.svelte.js";
  import type { ChatToolCall } from "../types.js";

  interface Props {
    calls: ChatToolCall[];
  }

  let { calls }: Props = $props();

  // Calls awaiting a decision are lifted out: they are not trace, they are a
  // question, and ConfirmationCard answers them.
  const trace = $derived(calls.filter((call) => call.status !== "awaiting_confirmation"));
  const running = $derived(trace.some((call) => call.status === "running"));
</script>

{#if trace.length > 0}
  <ul class="trace" aria-label={t("chat.tools_label")}>
    {#each trace as call (call.id)}
      <li class="call" class:failed={call.status === "error"}>
        <span class="glyph" class:live={call.status === "running"}>
          {#if call.status === "running"}
            <Icon name="spinner" size={11} />
          {:else if call.status === "error"}
            <Icon name="alert" size={11} />
          {:else}
            <Icon name="check" size={11} />
          {/if}
        </span>
        <code>{call.name}</code>
        {#if call.detail}<span class="detail">{call.detail}</span>{/if}
      </li>
    {/each}
  </ul>
  {#if running}
    <span class="sr-only" aria-live="polite">{t("chat.tools_running")}</span>
  {/if}
{/if}

<style>
  /* A ledger, not a feature list: one row per call, the name in the machine
     voice, everything else muted. It sits above the answer because that is the
     order it happened in. */
  .trace {
    list-style: none;
    margin: 0 0 6px 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .call {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    padding: 2px 0;
    color: var(--text-muted);
    font-size: 12px;
    line-height: 1.4;
  }

  .glyph {
    display: flex;
    color: var(--text-subtle);
  }

  /* Colour only where a state deserves it: a call in flight, a call that
     failed. A finished call is grey, like everything at rest. */
  .glyph.live {
    color: var(--accent);
  }

  .call.failed .glyph {
    color: var(--danger);
  }

  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12px;
    color: var(--text-body);
    white-space: nowrap;
  }

  .detail {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-muted);
  }

  .call.failed .detail {
    color: var(--danger);
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
