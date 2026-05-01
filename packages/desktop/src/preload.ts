// Bridge between the sandboxed renderer (Svelte UI) and the Electron
// main process. Anything exposed here is callable as `window.backlog.*`
// from the board-ui code.
import { contextBridge, ipcRenderer } from "electron";

// Mirror of UpdateStatus in main.ts. Kept inline here so preload.cjs
// stays self-contained — the type is also re-declared in board-ui's
// desktop-bridge.d.ts for the renderer.
type UpdateStatus =
  | { kind: "checking" }
  | { kind: "available"; version: string }
  | { kind: "not-available"; version: string }
  | { kind: "downloading"; percent: number; transferred: number; total: number }
  | { kind: "downloaded"; version: string }
  | { kind: "error"; message: string; detail?: string };

contextBridge.exposeInMainWorld("backlog", {
  // Reveal a path in the OS file manager (Finder on mac, Explorer on
  // win, default file manager on linux). Returns "" on success, or an
  // error string from shell.openPath.
  openPath(targetPath: string): Promise<string> {
    return ipcRenderer.invoke("backlog:open-path", targetPath);
  },
  // Reveal the parent and select the file (handy for hook scripts).
  showInFolder(targetPath: string): Promise<void> {
    return ipcRenderer.invoke("backlog:show-in-folder", targetPath);
  },
  // Open an external URL in the OS default browser. Used by the OAuth
  // sign-in flows so the user lands in their real browser (with their
  // session cookies) instead of a sandboxed Electron window.
  openExternal(url: string): Promise<void> {
    return ipcRenderer.invoke("backlog:open-external", url);
  },
  // Native folder picker — replaces typed paths everywhere we used to
  // ask the user for one. Returns the picked absolute path, or null
  // if the user cancelled.
  pickFolder(opts?: { title?: string; defaultPath?: string }): Promise<string | null> {
    return ipcRenderer.invoke("backlog:pick-folder", opts ?? {});
  },
  setLastWorkspace(targetPath: string): Promise<boolean> {
    return ipcRenderer.invoke("backlog:set-last-workspace", targetPath);
  },

  // ─── Auto-update surface ──────────────────────────────────────────
  // Manual "Check for Updates" button. Returns the most recent status
  // synchronously after the manifest fetch, but the full lifecycle is
  // streamed via onUpdateStatus below.
  checkForUpdates(): Promise<UpdateStatus | null> {
    return ipcRenderer.invoke("backlog:update-check");
  },
  // Restart the app and install the downloaded update. The renderer
  // should only call this when status.kind === "downloaded".
  installUpdate(): Promise<void> {
    return ipcRenderer.invoke("backlog:update-install");
  },
  // Last known status, replays on subscribe so a banner that mounts
  // mid-download doesn't miss the "downloading" → "downloaded"
  // transitions.
  getUpdateStatus(): Promise<UpdateStatus | null> {
    return ipcRenderer.invoke("backlog:update-status");
  },
  // Subscribe to live status events. Returns an unsubscribe function
  // — call it from onDestroy in the Svelte component.
  onUpdateStatus(callback: (status: UpdateStatus) => void): () => void {
    const listener = (_event: unknown, status: UpdateStatus) => callback(status);
    ipcRenderer.on("backlog:update-status", listener);
    return () => ipcRenderer.removeListener("backlog:update-status", listener);
  },
});
