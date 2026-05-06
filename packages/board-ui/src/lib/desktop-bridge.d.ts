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
  /** Open a path in the configured/default editor when possible. */
  openEditor?: (path: string) => Promise<string>;
  /** Open an external URL in the user's default browser. */
  openExternal: (url: string) => Promise<void>;
  /** Open a native folder picker; returns the selected path or null on cancel. */
  pickFolder: (opts?: { title?: string; defaultPath?: string }) => Promise<string | null>;
  /** Persist the project path Desktop should reopen next launch. */
  setLastProject: (path: string) => Promise<boolean>;
  /** @deprecated Use setLastProject. */
  setLastWorkspace?: (path: string) => Promise<boolean>;
  /** Trigger a manual update check. Same backend as the View menu item. */
  checkForUpdates: () => Promise<UpdateStatus | null>;
  /** Download an available update after explicit user confirmation. */
  downloadUpdate: () => Promise<UpdateStatus | null>;
  /** Restart the app and install a previously-downloaded update. */
  installUpdate: () => Promise<void>;
  /** Latest known update status (replayed for late subscribers). */
  getUpdateStatus: () => Promise<UpdateStatus | null>;
  /** Subscribe to update lifecycle events. Returns an unsubscribe fn. */
  onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void;
}

declare global {
  /**
   * Status of the auto-update lifecycle. Mirrors the same union in
   * packages/desktop/src/main.ts and preload.ts — keep the three in
   * sync. Declared inside `declare global` so Svelte components and
   * .ts files can refer to `UpdateStatus` directly without an import.
   */
  type UpdateStatus =
    | { kind: "checking" }
    | { kind: "available"; version: string }
    | { kind: "not-available"; version: string }
    | { kind: "downloading"; percent: number; transferred: number; total: number }
    | { kind: "downloaded"; version: string }
    | { kind: "error"; message: string; detail?: string };

  interface Window {
    backlog?: BacklogBridge;
  }
}

export {};
