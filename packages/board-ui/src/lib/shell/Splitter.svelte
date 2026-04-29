<script lang="ts">
  // Drag-to-resize handle. Used between the side panels and the center
  // content (vertical orientation, drags horizontally) and between the
  // center main area and the bottom panel (horizontal orientation,
  // drags vertically). Reports a delta in pixels — the parent decides
  // how to apply it (so it can clamp to min/max widths/heights and
  // persist them).
  interface Props {
    orientation: "vertical" | "horizontal";
    onResize: (delta: number) => void;
    onCommit?: () => void;
  }

  let { orientation, onResize, onCommit }: Props = $props();

  let dragging = $state(false);
  let lastPointer = 0;

  function onPointerDown(event: PointerEvent) {
    dragging = true;
    lastPointer = orientation === "vertical" ? event.clientX : event.clientY;
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function onPointerMove(event: PointerEvent) {
    if (!dragging) return;
    const next = orientation === "vertical" ? event.clientX : event.clientY;
    const delta = next - lastPointer;
    lastPointer = next;
    if (delta !== 0) onResize(delta);
  }

  function onPointerUp(event: PointerEvent) {
    if (!dragging) return;
    dragging = false;
    (event.target as HTMLElement).releasePointerCapture(event.pointerId);
    onCommit?.();
  }
</script>

<div
  class="splitter"
  class:vertical={orientation === "vertical"}
  class:horizontal={orientation === "horizontal"}
  class:dragging
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={onPointerUp}
  role="separator"
  aria-orientation={orientation === "vertical" ? "vertical" : "horizontal"}
></div>

<style>
  .splitter {
    background: transparent;
    flex-shrink: 0;
    transition: background 120ms ease;
    touch-action: none;
  }
  .splitter.vertical {
    width: 1px;
    cursor: col-resize;
    background: #e4e7ec;
    position: relative;
  }
  .splitter.vertical::after {
    /* Wider hit-target overlaid on top of the visible 1px line. */
    content: "";
    position: absolute;
    top: 0;
    bottom: 0;
    left: -3px;
    right: -3px;
  }
  .splitter.horizontal {
    height: 1px;
    cursor: row-resize;
    background: #e4e7ec;
    position: relative;
  }
  .splitter.horizontal::after {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    top: -3px;
    bottom: -3px;
  }
  .splitter:hover,
  .splitter.dragging {
    background: #1570ef;
  }
</style>
