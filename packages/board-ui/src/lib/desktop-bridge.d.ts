// Ambient declaration for the bridge that packages/desktop's preload.ts
// exposes on `window.backlog` via contextBridge. The board UI is shared
// between the Electron Desktop window and the regular browser-served
// `backlog serve`, so the bridge is optional — components that use it
// must guard with `if (window.backlog)` or `typeof window !== "undefined"
// && Boolean(window.backlog)`.
//
// This file lives at lib/ root rather than inline in each consumer so
// svelte-check sees one consistent declaration. Per-component
// `declare global { ... }` blocks fail svelte-check with "An ambient
// module declaration is only allowed at the top level in a file."

interface BacklogBridge {
  /** Open a path in the OS file manager / default app. Returns "" on success. */
  openPath: (path: string) => Promise<string>;
  /** Show a path in the OS file manager (Finder / Explorer / Files), highlighted. */
  showInFolder: (path: string) => Promise<void>;
  /** Open an external URL in the user's default browser. */
  openExternal: (url: string) => Promise<void>;
  /** Open a native folder picker; returns the selected path or null on cancel. */
  pickFolder: (opts?: { title?: string; defaultPath?: string }) => Promise<string | null>;
}

declare global {
  interface Window {
    backlog?: BacklogBridge;
  }
}

export {};
