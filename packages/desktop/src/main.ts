import { app, BrowserWindow, Menu, ipcMain, shell, dialog } from "electron";
import path from "node:path";
import { startServer, type RunningServer } from "@backlog/server";
import { resolveWorkspace } from "./workspace-picker.js";

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
ipcMain.handle("backlog:pick-folder", async (event, opts: unknown) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const options = (opts && typeof opts === "object" ? opts : {}) as {
    title?: string;
    defaultPath?: string;
  };
  const result = win
    ? await dialog.showOpenDialog(win, {
        title: options.title,
        defaultPath: options.defaultPath,
        properties: ["openDirectory", "createDirectory"],
      })
    : await dialog.showOpenDialog({
        title: options.title,
        defaultPath: options.defaultPath,
        properties: ["openDirectory", "createDirectory"],
      });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
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
  mainWindow.webContents.on("will-navigate", (event, targetUrl) => {
    if (!targetUrl.startsWith(serverHandle.url)) {
      event.preventDefault();
      void shell.openExternal(targetUrl);
    }
  });

  if (process.env.NODE_ENV === "development") {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }
}

function buildMenu(): void {
  const isMac = process.platform === "darwin";
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: app.name,
            submenu: [
              { role: "about" },
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
      app.exit(0);
    });
});
