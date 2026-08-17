<script lang="ts">
  import Icon from "./Icon.svelte";
  import { t } from "../i18n.svelte.js";
  import type { ChatToolCall } from "../types.js";

  interface Props {
    call: ChatToolCall;
    disabled?: boolean;
    onconfirm: () => void;
    oncancel: () => void;
  }

  let { call, disabled = false, onconfirm, oncancel }: Props = $props();

  // The arguments the model chose, shown as-is. This is the only place the user
  // sees what is actually about to run, so it is not summarised away.
  const args = $derived(
    Object.entries(call.input ?? {})
      .filter(([key]) => key !== "confirmed")
      .map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`),
  );
</script>

<section class="confirm" aria-live="polite">
  <header>
    <Icon name="lock" size={12} />
    <span class="label">{t("chat.confirm_title")}</span>
  </header>

  <code class="action">{call.name}</code>

  {#if args.length > 0}
    <ul class="args">
      {#each args as arg (arg)}
        <li>{arg}</li>
      {/each}
    </ul>
  {/if}

  <p class="why">{t("chat.confirm_why")}</p>

  <div class="choices">
    <button type="button" class="approve" onclick={onconfirm} {disabled}>
      {t("chat.confirm_approve")}
    </button>
    <button type="button" class="deny" onclick={oncancel} {disabled}>
      {t("chat.confirm_deny")}
    </button>
  </div>
</section>

<style>
  /* Amber, because this is a hold — not a failure and not a success. The card
     is the one place in the drawer that stops the eye, so it carries a fill
     rather than the flat surface every other block uses. */
  .confirm {
    margin: 6px 0;
    padding: 10px;
    border: 1px solid var(--warning);
    border-radius: 6px;
    background: var(--warning-bg);
    color: var(--text-body);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  header {
    display: flex;
    align-items: center;
    gap: 4px;
    color: var(--warning);
  }

  .label {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .action {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 13px;
    color: var(--text-strong);
    word-break: break-all;
  }

  .args {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12px;
    color: var(--text-secondary);
  }

  .args li {
    overflow-wrap: anywhere;
  }

  .why {
    margin: 0;
    font-size: 12px;
    color: var(--text-secondary);
  }

  .choices {
    display: flex;
    gap: 6px;
    margin-top: 2px;
  }

  button {
    flex: 1;
    padding: 6px 12px;
    border-radius: 4px;
    border: 1px solid transparent;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: background 120ms ease, border-color 120ms ease;
  }

  button:disabled {
    opacity: 0.55;
    cursor: default;
  }

  /* Approving starts real work — it gets the filled treatment. Declining is
     the safe path and stays quiet. */
  .approve {
    background: var(--warning);
    color: var(--warning-on);
  }

  .approve:hover:not(:disabled) {
    filter: brightness(0.94);
  }

  .deny {
    background: transparent;
    border-color: var(--border-field);
    color: var(--text-body);
  }

  .deny:hover:not(:disabled) {
    background: var(--bg-hover);
  }

  button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
</style>
