import { app, BrowserWindow, Menu } from "electron";
import path from "node:path";
import { startServer, type RunningServer } from "@backlog/server";
import { resolveWorkspace } from "./workspace-picker.js";

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
