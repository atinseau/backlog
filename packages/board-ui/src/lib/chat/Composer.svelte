<script lang="ts">
  import { tick } from "svelte";
  import Icon from "./Icon.svelte";
  import { t } from "../i18n.svelte.js";

  interface Props {
    busy: boolean;
    disabled?: boolean;
    onsend: (text: string) => void;
    onstop: () => void;
    /** A `/command` the user typed. Returns true when it was handled. */
    oncommand: (name: string) => boolean;
  }

  let { busy, disabled = false, onsend, onstop, oncommand }: Props = $props();

  let value = $state("");
  let field = $state<HTMLTextAreaElement | null>(null);

  // Slash commands are matched on the whole input, never mid-sentence: a
  // message that merely mentions /clear is still a message.
  const COMMANDS = ["clear", "new", "help"] as const;
  const typedCommand = $derived(/^\/(\w*)$/.exec(value.trim())?.[1] ?? null);
  const suggestions = $derived(
    typedCommand === null ? [] : COMMANDS.filter((name) => name.startsWith(typedCommand)),
  );

  // Measured after the DOM has caught up: reading scrollHeight in the same
  // tick as clearing the value measures the text that is still on screen, and
  // the box stays tall after sending.
  async function grow() {
    await tick();
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight, 160)}px`;
  }

  function submit() {
    const text = value.trim();
    if (!text || busy || disabled) return;

    const command = /^\/(\w+)$/.exec(text)?.[1];
    if (command && oncommand(command)) {
      value = "";
      void grow();
      return;
    }

    onsend(text);
    value = "";
    void grow();
  }

  function keydown(event: KeyboardEvent) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
      return;
    }
    // Tab completes the command being typed, the way a shell would.
    if (event.key === "Tab" && suggestions.length > 0) {
      event.preventDefault();
      value = `/${suggestions[0]}`;
    }
  }

  // Size it once it exists, so the resting height is one line whatever the
  // parent layout does to an unsized textarea.
  $effect(() => {
    if (field) void grow();
  });

  export function focus() {
    field?.focus();
  }
</script>

<form
  class="composer"
  onsubmit={(event) => {
    event.preventDefault();
    submit();
  }}
>
  {#if suggestions.length > 0}
    <ul class="hints">
      {#each suggestions as name (name)}
        <li><code>/{name}</code> <span>{t(`chat.command_${name}`)}</span></li>
      {/each}
    </ul>
  {/if}

  <div class="row">
    <textarea
      bind:this={field}
      bind:value
      rows="1"
      oninput={() => void grow()}
      onkeydown={keydown}
      placeholder={disabled ? t("chat.unavailable_short") : t("chat.placeholder")}
      disabled={disabled || busy}
      aria-label={t("chat.placeholder")}
    ></textarea>

    {#if busy}
      <button type="button" class="act stop" onclick={onstop} title={t("chat.stop")}>
        <Icon name="stop" size={12} />
      </button>
    {:else}
      <button
        type="submit"
        class="act send"
        disabled={disabled || value.trim().length === 0}
        title={t("chat.send")}
      >
        <Icon name="send" size={12} />
      </button>
    {/if}
  </div>
</form>

<style>
  .composer {
    flex-shrink: 0;
    border-top: 1px solid var(--border-default);
    background: var(--bg-surface);
  }

  .row {
    display: flex;
    align-items: flex-end;
    gap: 6px;
    padding: 8px;
  }

  /* Human input is never on the console ground, whatever the theme. */
  textarea {
    flex: 1;
    align-self: flex-end;
    height: 34px;
    min-height: 34px;
    max-height: 160px;
    padding: 7px 8px;
    border: 1px solid var(--border-field);
    border-radius: 4px;
    background: var(--bg-input);
    color: var(--text-primary);
    font-family: inherit;
    font-size: 13px;
    line-height: 1.45;
    resize: none;
  }

  textarea:focus {
    outline: 2px solid var(--accent);
    outline-offset: -1px;
    border-color: var(--accent);
  }

  textarea:disabled {
    opacity: 0.6;
  }

  .act {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 32px;
    height: 32px;
    border: 1px solid transparent;
    border-radius: 4px;
    cursor: pointer;
    transition: background 120ms ease;
  }

  .send {
    background: var(--accent);
    color: var(--accent-on);
  }

  .send:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .send:disabled {
    background: var(--bg-hover);
    color: var(--text-subtle);
    cursor: default;
  }

  /* Stopping is not destructive, so it is outlined rather than filled. */
  .stop {
    background: transparent;
    border-color: var(--border-field);
    color: var(--text-body);
  }

  .stop:hover {
    background: var(--bg-hover);
  }

  .act:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .hints {
    list-style: none;
    margin: 0;
    padding: 6px 8px 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .hints li {
    display: flex;
    gap: 8px;
    font-size: 11px;
    color: var(--text-muted);
  }

  .hints code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    color: var(--accent-text);
  }
</style>
