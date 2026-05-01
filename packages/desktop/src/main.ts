import { app, BrowserWindow, Menu, ipcMain, shell, dialog } from "electron";
import path from "node:path";
import { startServer, type RunningServer } from "@backlog/server";
import pkg from "electron-updater";
import { rememberWorkspace, resolveWorkspace } from "./workspace-picker.js";

// electron-updater ships as a CommonJS module — destructure on the
// default export so the same import works under both Node CJS and the
// ESM bundle tsup produces.
const { autoUpdater } = pkg;

// IPC handlers exposed to the renderer through the preload's
// contextBridge (window.backlog.*). Keep the surface tiny — anything
// the embedded Hono server can already do should go through HTTP.
ipcMain.handle("backlog:open-path", async (_event, targetPath: unknown) => {
  if (typeof targetPath !== "string" || !targetPath) return "invalid_path";
  return shell.openPath(targetPath);
});
ipcMain.handle("backlog:show-in-folder", async (_event, targetPath: unknown) => {
  if (typeof targetPath !== "string" || !targetPath) return;
  shell.showItemInFolder(targetPath);
});
ipcMain.handle("backlog:open-external", async (_event, url: unknown) => {
  if (typeof url !== "string" || !url) return;
  if (!/^https?:\/\//.test(url)) return; // never let renderer open file:// or shell URLs
  await shell.openExternal(url);
});
// Update lifecycle, exposed to the renderer so the kanban can show an
// in-app banner ("update available", "downloading…", "ready to restart")
// in addition to the native macOS notification. Two surfaces use this:
// the View → Check for Updates menu item below, and the UpdateBanner
// component in board-ui. Both share the same IPC channel.
type UpdateStatus =
  | { kind: "checking" }
  | { kind: "available"; version: string }
  | { kind: "not-available"; version: string }
  | { kind: "downloading"; percent: number; transferred: number; total: number }
  | { kind: "downloaded"; version: string }
  // `message` is the short user-friendly line shown in the banner.
  // `detail` carries the original error string for debugging — the
  // banner exposes it as a tooltip so power users can still read it
  // without it dominating the UI.
  | { kind: "error"; message: string; detail?: string };

let lastUpdateStatus: UpdateStatus | null = null;

// Translate raw electron-updater error strings into something a normal
// user can read. The library's defaults look like:
//   `Cannot find latest-mac.yml in the latest release artifacts
//    (https://github.com/osmove/backlog/releases/download/v1.4.7/
//    latest-mac.yml): HttpError: 404 …`
// which is terrifying for someone who just wanted to click "Check for
// Updates". Each branch below maps a known failure mode to a short,
// reassuring sentence + the original message tucked in `detail` for
// debugging via the banner tooltip. Anything we can't classify falls
// through to a generic "Update failed, please try again later".
function humanizeUpdateError(raw: string): { message: string; detail: string } {
  const detail = raw;
  // 404 on latest-*.yml = the GitHub Release exists (so electron-updater
  // discovered v$NEW) but the platform-specific manifest hasn't been
  // uploaded yet. Happens during the ~3-minute window between the first
  // platform job uploading its artifacts (which creates the Release as
  // "published") and the macOS job finishing its notarization. The user
  // who hit the bug above was caught in exactly this window.
  if (/latest-(mac|linux|win)?\.?ya?ml/i.test(raw) && /404|not.*found|cannot find/i.test(raw)) {
    return {
      message: "La nouvelle version est en cours de finalisation. Réessaye dans 2-3 minutes.",
      detail,
    };
  }
  if (/ENOTFOUND|getaddrinfo|EAI_AGAIN/i.test(raw)) {
    return {
      message: "Pas de connexion internet. L'app vérifiera à la prochaine ouverture.",
      detail,
    };
  }
  if (/ETIMEDOUT|ESOCKETTIMEDOUT/i.test(raw)) {
    return {
      message: "Connexion au serveur de mises à jour trop lente. Réessaye plus tard.",
      detail,
    };
  }
  if (/rate.?limit|too many requests|HTTP 403/i.test(raw)) {
    return {
      message: "GitHub limite temporairement les requêtes. Réessaye dans quelques minutes.",
      detail,
    };
  }
  if (/code.?sign|signature|trust/i.test(raw)) {
    return {
      message: "La nouvelle version est signée différemment. Télécharge-la manuellement depuis backlog.so/desktop.",
      detail,
    };
  }
  if (/disk.*space|ENOSPC/i.test(raw)) {
    return {
      message: "Espace disque insuffisant pour télécharger la mise à jour.",
      detail,
    };
  }
  return {
    message: "Mise à jour indisponible pour l'instant. Réessaye plus tard.",
    detail,
  };
}

function broadcastUpdateStatus(status: UpdateStatus): void {
  lastUpdateStatus = status;
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("backlog:update-status", status);
  }
}

ipcMain.handle("backlog:update-check", async () => {
  // Respond fast — checkForUpdates resolves once the manifest is fetched,
  // not after the download finishes. The renderer pivots its UI on the
  // status events broadcast above.
  if (process.env.NODE_ENV === "development") {
    return { kind: "error", message: "auto-update disabled in dev builds" } as UpdateStatus;
  }
  try {
    broadcastUpdateStatus({ kind: "checking" });
    const result = await autoUpdater.checkForUpdates();
    if (!result || !result.updateInfo) {
      const status: UpdateStatus = { kind: "not-available", version: app.getVersion() };
      broadcastUpdateStatus(status);
      return status;
    }
    return lastUpdateStatus ?? { kind: "checking" };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const { message, detail } = humanizeUpdateError(raw);
    const status: UpdateStatus = { kind: "error", message, detail };
    broadcastUpdateStatus(status);
    return status;
  }
});

ipcMain.handle("backlog:update-install", async () => {
  // quitAndInstall closes every window and triggers the installer. Only
  // safe to call once an update has actually been downloaded — the
  // renderer guards the button visibility on lastUpdateStatus.kind ===
  // "downloaded".
  try {
    autoUpdater.quitAndInstall();
  } catch (err) {
    console.warn("[auto-update] quitAndInstall failed:", err instanceof Error ? err.message : err);
  }
});

ipcMain.handle("backlog:update-status", async () => lastUpdateStatus);

ipcMain.handle("backlog:pick-folder", async (event, opts: unknown) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const raw = (opts && typeof opts === "object" ? opts : {}) as {
    title?: string;
    defaultPath?: string;
  };
  const dialogOptions: Electron.OpenDialogOptions = {
    properties: ["openDirectory", "createDirectory"],
  };
  if (raw.title) dialogOptions.title = raw.title;
  if (raw.defaultPath) dialogOptions.defaultPath = raw.defaultPath;
  const result = win
    ? await dialog.showOpenDialog(win, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions);
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});
ipcMain.handle("backlog:set-last-workspace", async (_event, targetPath: unknown) => {
  if (typeof targetPath !== "string" || !targetPath) return false;
  return rememberWorkspace(targetPath);
});

// Set the user-facing name early so app.getPath('userData') resolves to a
// stable, branded directory (e.g. ~/Library/Application Support/Backlog/).
app.setName("Backlog");

let serverHandle: RunningServer | null = null;
let mainWindow: BrowserWindow | null = null;

function uiDistDir(): string {
  // tsup's onSuccess copies ../server/dist/public → dist/public next to this file.
  return path.join(__dirname, "public");
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    title: "Backlog",
    backgroundColor: "#0f172a",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  const workspace = await resolveWorkspace(mainWindow);
  if (!workspace) {
    mainWindow.close();
    mainWindow = null;
    app.quit();
    return;
  }

  serverHandle = await startServer({
    host: "127.0.0.1",
    port: 0,
    workspace,
    uiDistDir: uiDistDir(),
  });

  await mainWindow.loadURL(serverHandle.url);
  mainWindow.show();

  // Route any window.open(url) the renderer attempts to the OS default
  // browser instead of spawning a child BrowserWindow. Critical for the
  // OAuth flow (Google / GitHub / Apple sign-in) — the user needs to
  // land in their actual browser where they're already signed in.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  // Same idea for in-page <a target="_blank">. Block any navigation
  // away from the embedded server's origin.
  const localOrigin = serverHandle.url;
  mainWindow.webContents.on("will-navigate", (event, targetUrl) => {
    if (!targetUrl.startsWith(localOrigin)) {
      event.preventDefault();
      void shell.openExternal(targetUrl);
    }
  });

  if (process.env.NODE_ENV === "development") {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }
}

// Trigger a manual update check from the menu. Same IPC handler as the
// in-app banner button, so the surfaces stay consistent — one path,
// idempotent if both fire concurrently.
function checkForUpdatesFromMenu(): void {
  if (process.env.NODE_ENV === "development") {
    void dialog.showMessageBox({
      type: "info",
      message: "Updates disabled in dev builds.",
      detail: "Run a packaged build (`pnpm dist:mac`) to test the auto-update flow.",
    });
    return;
  }
  broadcastUpdateStatus({ kind: "checking" });
  autoUpdater.checkForUpdates().catch((err: unknown) => {
    const raw = err instanceof Error ? err.message : String(err);
    const { message, detail } = humanizeUpdateError(raw);
    broadcastUpdateStatus({ kind: "error", message, detail });
  });
}

function buildMenu(): void {
  const isMac = process.platform === "darwin";
  const updateMenuItem: Electron.MenuItemConstructorOptions = {
    label: "Check for Updates…",
    click: () => checkForUpdatesFromMenu(),
  };
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              updateMenuItem,
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ] as Electron.MenuItemConstructorOptions[])
      : []),
    {
      label: "File",
      submenu: [isMac ? { role: "close" } : { role: "quit" }],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...(isMac
          ? ([{ type: "separator" }, { role: "front" }] as Electron.MenuItemConstructorOptions[])
          : ([{ role: "close" }] as Electron.MenuItemConstructorOptions[])),
      ],
    },
    // Help menu — cross-platform home for "Check for Updates…" so
    // Windows + Linux users can trigger a manual check (mac users get
    // it under the app menu too, by convention).
    {
      label: "Help",
      submenu: [
        ...(isMac
          ? ([] as Electron.MenuItemConstructorOptions[])
          : ([updateMenuItem, { type: "separator" }] as Electron.MenuItemConstructorOptions[])),
        {
          label: "Backlog on GitHub",
          click: () => void shell.openExternal("https://github.com/osmove/backlog"),
        },
        {
          label: "Report an Issue",
          click: () => void shell.openExternal("https://github.com/osmove/backlog/issues"),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

let isQuitting = false;

app.whenReady().then(async () => {
  buildMenu();
  await createWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });

  // Auto-update check. electron-updater reads the publish config from
  // electron-builder.yml at build time + the latest-mac.yml uploaded
  // alongside each release. checkForUpdatesAndNotify shows a native
  // notification when an update is downloaded; clicking it prompts to
  // restart and install. Skipped in dev (no builder metadata bundled).
  // Failures (no internet, GitHub rate-limited, malformed manifest)
  // are logged and swallowed — never crash the app over an update
  // check.
  if (process.env.NODE_ENV !== "development") {
    try {
      // Auto-download is on by default; we only opt out of auto-install
      // so the user keeps control over when the restart happens.
      autoUpdater.autoInstallOnAppQuit = true;
      autoUpdater.on("checking-for-update", () => {
        broadcastUpdateStatus({ kind: "checking" });
      });
      autoUpdater.on("error", (err: Error) => {
        // Keep the raw message in the console for power users / bug
        // reports, but ship a friendly version to the renderer banner.
        console.warn("[auto-update] error:", err.message);
        const { message, detail } = humanizeUpdateError(err.message);
        broadcastUpdateStatus({ kind: "error", message, detail });
      });
      autoUpdater.on("update-available", (info: { version: string }) => {
        console.log(`[auto-update] new version available: ${info.version}`);
        broadcastUpdateStatus({ kind: "available", version: info.version });
      });
      autoUpdater.on("update-not-available", (info: { version: string }) => {
        broadcastUpdateStatus({ kind: "not-available", version: info.version });
      });
      autoUpdater.on(
        "download-progress",
        (progress: { percent: number; transferred: number; total: number }) => {
          broadcastUpdateStatus({
            kind: "downloading",
            percent: progress.percent,
            transferred: progress.transferred,
            total: progress.total,
          });
        },
      );
      autoUpdater.on("update-downloaded", (info: { version: string }) => {
        console.log(`[auto-update] downloaded ${info.version} — will install on quit`);
        broadcastUpdateStatus({ kind: "downloaded", version: info.version });
      });
      void autoUpdater.checkForUpdatesAndNotify();
    } catch (err) {
      console.warn("[auto-update] init failed:", err instanceof Error ? err.message : err);
    }
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", (event) => {
  if (isQuitting || !serverHandle) return;
  event.preventDefault();
  isQuitting = true;
  const handle = serverHandle;
  serverHandle = null;
  handle
    .close()
    .catch(() => {
      // Best effort — don't block shutdown if the server hangs.
    })
    .finally(() => {
      // CRITICAL: must be `app.quit()`, NOT `app.exit(0)`. The latter
      // skips the `will-quit` and `quit` events, which is exactly where
      // electron-updater hooks `autoInstallOnAppQuit` to actually run
      // the installer for a downloaded update. Using `app.exit()` here
      // (the original implementation) silently broke auto-update — the
      // .dmg got fetched into ~/Library/Caches/backlog-updater/ but the
      // installer never ran on quit, so users stayed pinned to their
      // installed version no matter how many times they quit + relaunched.
      //
      // app.quit() re-fires before-quit. The isQuitting guard above
      // catches the second call and early-returns, so we don't loop.
      app.quit();
    });
});
