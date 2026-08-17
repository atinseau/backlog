// Sentinel for the "custom…" option in the model dropdown. The catalogue
// itself is served by GET /providers — see providers.svelte.ts — so the board
// never carries a stale copy of which models exist.
export const CUSTOM_MODEL_VALUE = "__custom__";
