// Bridge between the sandboxed renderer (Svelte UI) and the Electron
// main process. Anything exposed here is callable as `window.backlog.*`
// from the board-ui code.
import { contextBridge, ipcRenderer } from "electron";

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
});
