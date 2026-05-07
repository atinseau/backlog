<script lang="ts">
  // Three Xcode-style toggle buttons for the left, bottom, and right
  // panels. Each shows a small rectangle with the corresponding edge
  // permanently marked; the active state only changes emphasis.
  interface Props {
    leftOpen: boolean;
    bottomOpen: boolean;
    rightOpen: boolean;
    onToggleLeft: () => void;
    onToggleBottom: () => void;
    onToggleRight: () => void;
  }

  let {
    leftOpen,
    bottomOpen,
    rightOpen,
    onToggleLeft,
    onToggleBottom,
    onToggleRight,
  }: Props = $props();
</script>

<div class="toggles">
  <button
    class="toggle"
    class:active={leftOpen}
    onclick={onToggleLeft}
    title={leftOpen ? "Hide navigator" : "Show navigator"}
    aria-label="Toggle navigator panel"
    aria-pressed={leftOpen}
  >
    <svg width="18" height="14" viewBox="0 0 18 14" fill="none">
      <rect x="0.5" y="0.5" width="17" height="13" rx="2" stroke="currentColor" />
      <rect class="pane-marker" x="0.5" y="0.5" width="6" height="13" fill="currentColor" />
    </svg>
  </button>
  <button
    class="toggle"
    class:active={bottomOpen}
    onclick={onToggleBottom}
    title={bottomOpen ? "Hide debug area" : "Show debug area"}
    aria-label="Toggle bottom panel"
    aria-pressed={bottomOpen}
  >
    <svg width="18" height="14" viewBox="0 0 18 14" fill="none">
      <rect x="0.5" y="0.5" width="17" height="13" rx="2" stroke="currentColor" />
      <rect class="pane-marker" x="0.5" y="8.5" width="17" height="5" fill="currentColor" />
    </svg>
  </button>
  <button
    class="toggle"
    class:active={rightOpen}
    onclick={onToggleRight}
    title={rightOpen ? "Hide inspector" : "Show inspector"}
    aria-label="Toggle inspector panel"
    aria-pressed={rightOpen}
  >
    <svg width="18" height="14" viewBox="0 0 18 14" fill="none">
      <rect x="0.5" y="0.5" width="17" height="13" rx="2" stroke="currentColor" />
      <rect class="pane-marker" x="11.5" y="0.5" width="6" height="13" fill="currentColor" />
    </svg>
  </button>
</div>

<style>
  .toggles {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    padding: 2px;
    background: var(--bg-muted);
  }
  .toggle {
    background: transparent;
    border: none;
    border-radius: 4px;
    padding: 4px 6px;
    cursor: pointer;
    color: var(--text-subtle);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    line-height: 0;
    transition: background 120ms ease, color 120ms ease;
  }
  .toggle :global(.pane-marker) {
    opacity: 0.4;
  }
  .toggle:hover {
    background: var(--bg-active);
    color: var(--text-secondary);
  }
  .toggle.active {
    color: var(--accent);
  }
  .toggle.active :global(.pane-marker) {
    opacity: 1;
  }
  .toggle.active:hover {
    background: var(--accent-bg);
  }
</style>
